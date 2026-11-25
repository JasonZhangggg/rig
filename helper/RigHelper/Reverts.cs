// The revert ledger: how a protection Rig turned off for a while comes back
// on by itself, whatever happens in between.
//
// One file per protection row in %ProgramData%\Rig\Reverts, which only admins
// and the system can read or change. The file's name is the row, so a file
// that is there at all means "this row must end up on". Its state says how
// far things got:
//
//   asked    the helper, approved and with admin rights, wants to lower the
//            row. Nothing is lowered yet.
//   armed    the running service saw the ask and set the time it comes back
//            on. Only the service writes this, and the helper lowers nothing
//            without it.
//   lowered  the helper is lowering the row, or has. Written before it does.
//   raised   it is back on: the time was up, the service stopped, Rig was
//            uninstalled, or the person chose "Turn it back on now".
//   left     it was already on when the time was up: the person turned it
//            back on themselves, so nothing was changed.
//   kept     the person chose, with a second approval, to keep it off.
//   unused   it was never lowered.
//
// Every state is written whole to a new file and renamed over the old one
// before the step it stands for, and every change of state is made holding
// the folder's lock. So a crash or a power cut leaves one of the states
// above, and Settle takes each of them to the same end: the row on (or kept
// off by the person's own choice), one line in log.jsonl, the file gone.
//
// Nothing here lowers a protection, and nothing here holds or runs script
// text. Raising is the row's own code (Protection.cs), found by the row's id.
//
// The service raises. So does the admin helper, as a fallback while the app
// is open: a row 90 seconds past its time (RevertKeeper.AppGraceMs) is raised
// when the app asks how things stand (Protections.Reverts). That, too, only
// ever raises.

using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

/// One row's entry in the ledger. `Was` is the row's own name for how it was on, from the row's fixed list. `By` is the
/// service's process id, set when it armed the entry. Times are Unix milliseconds.
public sealed record Revert(string Id, string Row, string State, int Seconds, long AskedAt, long DueAt = 0, string? Was = null, int By = 0, long EndedAt = 0, string? Why = null)
{
    public const string Asked = "asked", Armed = "armed", Lowered = "lowered", Raised = "raised", Left = "left", Kept = "kept", Unused = "unused";
    /// What Settle makes of a file it can't read: lowered and due.
    public const string Broken = "broken";

    public bool Ended => State is Raised or Left or Kept or Unused;

    /// The state machine: every move there is.
    public static bool Can(string from, string to) => (from, to) switch
    {
        (Asked, Armed) or (Asked, Unused) => true,
        (Armed, Lowered) or (Armed, Raised) or (Armed, Unused) => true,
        (Lowered, Raised) or (Lowered, Left) or (Lowered, Kept) or (Lowered, Unused) => true,
        (Broken, Raised) or (Broken, Left) => true,
        _ => false,
    };

    public JsonObject ToJson() => new()
    {
        ["id"] = Id, ["row"] = Row, ["state"] = State, ["seconds"] = Seconds, ["askedAt"] = AskedAt, ["dueAt"] = DueAt,
        ["was"] = Was, ["by"] = By, ["endedAt"] = EndedAt, ["why"] = Why,
    };

    public static Revert? From(JsonNode? n, string row)
    {
        if (n is not JsonObject o || o["id"]?.ToString() is not string id || !CommandStore.Id.IsMatch(id) || o["row"]?.ToString() != row) return null;
        string state = o["state"]?.ToString() ?? "";
        if (state is not (Asked or Armed or Lowered or Raised or Left or Kept or Unused)) return null;
        return new Revert(id, row, state, (int)Json.Num(o["seconds"], 0), (long)Json.Num(o["askedAt"], 0), (long)Json.Num(o["dueAt"], 0),
            o["was"]?.ToString(), (int)Json.Num(o["by"], 0), (long)Json.Num(o["endedAt"], 0), o["why"]?.ToString());
    }
}

public sealed class Ledger
{
    /// How long the helper waits for the service to arm an ask, and how old an ask the service still arms.
    public const int AckWaitMs = 20_000, AskFreshMs = 60_000;
    /// The service looks at least this often, and this soon again when a row wouldn't come back on.
    public const int IdleMs = 15_000, RetryMs = 5_000;
    const int KeepLogLines = 300;

    public const string NoService = "Rig's background service didn't answer, so Rig can't promise to turn this back on by itself. Nothing was changed. Turn on the background recorder in Rig's Settings (or update Rig), then ask again.";
    public const string Busy = "This is already off for now, and Rig turns it back on by itself. Turn it back on first, or wait.";
    public const string Gone = "Rig's background service stopped before this was turned off, so nothing was changed. Ask again.";
    public const string NothingToKeep = "This isn't waiting to come back on, so there is nothing to keep off.";

    static readonly Regex RowName = new("^[a-z0-9][a-z0-9-]{0,39}$");
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    readonly string dir;
    readonly bool secured;

    /// The folders this process has made admins' own: once is enough, since every file is still checked as it is read.
    static readonly ConcurrentDictionary<string, bool> Made = new(StringComparer.OrdinalIgnoreCase);

    /// The PC's ledger. Only a process with admin rights can open it.
    public static Ledger Open() => new(RecorderPaths.Reverts, secured: true);

    public Ledger(string dir, bool secured)
    {
        this.dir = dir;
        this.secured = secured;
        if (!secured) Directory.CreateDirectory(dir);
        else if (!Made.ContainsKey(dir) || !Directory.Exists(dir))
        {
            CommandStore.Secure(dir);
            Made[dir] = true;
        }
    }

    string FileOf(string row) => Path.Combine(dir, row + ".json");
    string LogFile => Path.Combine(dir, "log.jsonl");

    /// Holds the folder's lock for one change of state. A holder that dies lets go of it.
    T Locked<T>(Func<T> act)
    {
        Directory.CreateDirectory(dir);
        for (int i = 0; ; i++)
        {
            FileStream held;
            try { held = new FileStream(Path.Combine(dir, "lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) when (i < 1200) { Thread.Sleep(50); continue; }
            using (held) return act();
        }
    }

    /// The rows with an entry, by file name.
    public List<string> Rows()
    {
        if (!Directory.Exists(dir)) return [];
        return Directory.EnumerateFiles(dir, "*.json").Select(f => Path.GetFileNameWithoutExtension(f)).Where(r => RowName.IsMatch(r)).OrderBy(r => r, StringComparer.Ordinal).ToList();
    }

    /// A row's entry, null when it has none. A file that isn't an entry Rig wrote reads as Broken, which Settle raises.
    public Revert? Read(string row)
    {
        string file = FileOf(row);
        if (!RowName.IsMatch(row) || !File.Exists(file)) return null;
        JsonNode? n = null;
        if (!secured || AdminFile.Trusted(file))
        {
            try { n = JsonNode.Parse(File.ReadAllText(file)); }
            catch (Exception e) when (e is System.Text.Json.JsonException or IOException or UnauthorizedAccessException) { }
        }
        return Revert.From(n, row) ?? new Revert(CommandStore.NewId(), row, Revert.Broken, 0, 0);
    }

    /// Writes an entry whole and renames it into place, so a reader sees the old state or the new one and never half of either.
    void Write(Revert r)
    {
        string file = FileOf(r.Row), tmp = file + ".tmp";
        using (var f = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            f.Write(Encoding.UTF8.GetBytes(r.ToJson().ToJsonString()));
            f.Flush(flushToDisk: true);
        }
        File.Move(tmp, file, overwrite: true);
    }

    Revert Move(Revert r, string to, Func<Revert, Revert>? with = null)
    {
        if (!Revert.Can(r.State, to)) throw new InvalidOperationException($"A revert can't go from {r.State} to {to}.");
        var next = (with?.Invoke(r) ?? r) with { State = to };
        Write(next);
        return next;
    }

    /// Ends an entry: the end state first, then its line in the log, then the file. Stopped anywhere, Settle picks it up.
    void End(Revert r, string to, string why) => Finish(Move(r, to, x => x with { EndedAt = Now, Why = why }));

    void Finish(Revert ended)
    {
        if (!Log().Any(l => l["id"]?.ToString() == ended.Id))
        {
            var lines = Log().TakeLast(KeepLogLines - 1).Select(l => l.ToJsonString()).ToList();
            lines.Add(new JsonObject { ["id"] = ended.Id, ["row"] = ended.Row, ["how"] = ended.State, ["why"] = ended.Why, ["at"] = ended.EndedAt, ["dueAt"] = ended.DueAt }.ToJsonString());
            string tmp = LogFile + ".tmp";
            using (var f = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                f.Write(Encoding.UTF8.GetBytes(string.Join("\n", lines) + "\n"));
                f.Flush(flushToDisk: true);
            }
            File.Move(tmp, LogFile, overwrite: true);
        }
        File.Delete(FileOf(ended.Row));
    }

    /// How each revert ended, oldest first: `{ id, row, how, why, at, dueAt }`.
    public List<JsonObject> Log()
    {
        var lines = new List<JsonObject>();
        if (!File.Exists(LogFile) || (secured && !AdminFile.Trusted(LogFile))) return lines;
        foreach (string line in File.ReadAllLines(LogFile))
        {
            try { if (JsonNode.Parse(line) is JsonObject o) lines.Add(o); }
            catch (System.Text.Json.JsonException) { }
        }
        return lines;
    }

    // ----- The helper's side: only behind an approved step -----

    /// Asks the running service to arm a revert for this row and waits for it. Returns the armed entry, or throws with
    /// nothing changed and no entry left. `was`: the row's own word for how it is on now.
    public Revert Arm(string row, int seconds, string? was, int waitMs = AckWaitMs)
    {
        var asked = Locked(() =>
        {
            if (Read(row) != null) throw new RigException(Busy);
            var r = new Revert(CommandStore.NewId(), row, Revert.Asked, seconds, Now, Was: was);
            Write(r);
            return r;
        });
        Revert? Mine() => Read(row) is Revert r && r.Id == asked.Id ? r : null;
        var waited = System.Diagnostics.Stopwatch.StartNew();
        while (waited.ElapsedMilliseconds < waitMs)
        {
            if (Mine() is { State: Revert.Armed } armed) return armed;
            Thread.Sleep(100);
        }
        return Locked(() =>
        {
            var r = Mine();
            if (r is { State: Revert.Armed }) return r;
            if (r is { State: Revert.Asked }) End(r, Revert.Unused, "no answer");
            throw new RigException(NoService);
        });
    }

    /// Lowers the row, only while its entry is still the armed one, with the lock held so the service can't end the
    /// entry in between. The entry says lowered before anything is lowered. When lowering fails the row is raised again.
    public Revert Lower(Revert armed, IProtection row) => Locked(() =>
    {
        if (Read(armed.Row) is not Revert r || r.Id != armed.Id || r.State != Revert.Armed) throw new RigException(Gone);
        var lowered = Move(r, Revert.Lowered);
        try { row.Lower(); }
        catch
        {
            try { row.Raise(lowered.Was); if (row.On()) End(lowered, Revert.Unused, "couldn't turn it off"); } catch { }
            throw;
        }
        return lowered;
    });

    /// The person's second choice: the revert is called off and the row stays as it is.
    public void Keep(string row) => Locked(() =>
    {
        if (Read(row) is not { State: Revert.Lowered } r) throw new RigException(NothingToKeep);
        End(r, Revert.Kept, "you");
        return true;
    });

    /// "Turn it back on now": raises the row and ends its entry, if it has one.
    public void RaiseNow(IProtection row, string why = "you") => Locked(() =>
    {
        var r = Read(row.Id);
        if (!row.On()) row.Raise(r?.Was);
        if (!row.On()) throw new RigException($"{row.Name} didn't come back on. Turn it on in Windows Security.");
        if (r is { State: Revert.Armed or Revert.Lowered or Revert.Broken }) End(r, r.State == Revert.Armed ? Revert.Unused : Revert.Raised, why);
        else if (r is { State: Revert.Asked }) End(r, Revert.Unused, why);
        else if (r is { Ended: true }) Finish(r);
        return true;
    });

    // ----- Settling: the one way every entry ends -----

    /// What a round found: when to look again, and what couldn't be raised.
    public sealed record Round(int NextMs, List<string> Stuck);

    /// Takes every entry one step toward its end. `arms`: this is the running service, the only one that arms an ask.
    /// `due` says whether an armed or lowered entry's time is up; with `all`, every entry's is. It only ever raises.
    public Round Settle(Func<string, IProtection?> rows, bool arms, Func<Revert, bool> due, string why, bool all = false)
    {
        int next = IdleMs;
        var stuck = new List<string>();
        foreach (string row in Rows())
        {
            int wait = Locked(() => SettleOne(row, rows(row), arms, due, why, all, stuck));
            next = Math.Min(next, wait);
        }
        return new Round(Math.Max(next, 200), stuck);
    }

    int SettleOne(string row, IProtection? p, bool arms, Func<Revert, bool> due, string why, bool all, List<string> stuck)
    {
        if (Read(row) is not Revert r) return IdleMs;
        if (r.Ended) { Finish(r); return IdleMs; }
        long now = Now;
        if (r.State == Revert.Asked)
        {
            // Nothing was lowered for an ask nobody armed.
            if (all || now - r.AskedAt > AskFreshMs || now < r.AskedAt - AskFreshMs || p == null || !p.Allows(r.Seconds)) End(r, Revert.Unused, all ? why : "not armed");
            else if (arms) { r = Move(r, Revert.Armed, x => x with { DueAt = now + x.Seconds * 1000L, By = Environment.ProcessId }); return (int)Math.Min(IdleMs, r.Seconds * 1000L); }
            return IdleMs;
        }
        if (!(all || r.State == Revert.Broken || due(r))) return (int)Math.Clamp(r.DueAt - now, 200, IdleMs);
        if (p == null) { stuck.Add($"{row}: this copy of Rig doesn't know it"); return IdleMs; }
        try
        {
            if (p.On()) { End(r, r.State == Revert.Armed ? Revert.Unused : Revert.Left, why); return IdleMs; }
            p.Raise(r.Was);
            if (p.On()) { End(r, Revert.Raised, why); return IdleMs; }
            stuck.Add($"{row}: it still reads off");
        }
        catch (Exception e) { stuck.Add($"{row}: {e.Message}"); }
        return RetryMs;
    }

    /// Raises every row with an entry, now. For the ways the service ends: stop, uninstall, removing itself.
    public List<string> RaiseAll(Func<string, IProtection?> rows, string why)
    {
        var stuck = new List<string>();
        for (int i = 0; i < 3; i++)
        {
            stuck = Settle(rows, arms: false, _ => true, why, all: true).Stuck;
            if (stuck.Count == 0) break;
            Thread.Sleep(1000);
        }
        return stuck;
    }

    /// Removes the ledger. Called only after RaiseAll.
    public void Drop()
    {
        try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); } catch { }
    }

    /// For the app: what waits to come back on and how the last ones ended.
    public JsonObject Status()
    {
        var waiting = new JsonArray();
        foreach (string row in Rows())
            if (Read(row) is { State: Revert.Armed or Revert.Lowered } r)
                waiting.Add(new JsonObject { ["id"] = r.Id, ["row"] = r.Row, ["dueAt"] = Iso(r.DueAt) });
        var ended = new JsonArray(Log().TakeLast(50).Select(l => (JsonNode)new JsonObject
        {
            ["id"] = l["id"]?.ToString(), ["row"] = l["row"]?.ToString(), ["how"] = l["how"]?.ToString(), ["why"] = l["why"]?.ToString(), ["at"] = Iso((long)Json.Num(l["at"], 0)),
        }).ToArray());
        return new JsonObject { ["readable"] = true, ["waiting"] = waiting, ["ended"] = ended };
    }

    public static string Iso(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    /// A test's way to put an entry in the ledger as a crash would have left it. Only code in this process can call it.
    internal void TestOnlyPut(Revert r) => Locked(() => { Write(r); return true; });
    internal void TestOnlyPutRaw(string row, string text) => Locked(() => { File.WriteAllText(FileOf(row), text); return true; });
    /// A test's way to stop after an end state is written, before its log line.
    internal void TestOnlyEndWithoutFinish(Revert r, string to) => Locked(() => { Move(r, to, x => x with { EndedAt = Now, Why = "test" }); return true; });
}

/// The service's side: watches the ledger, arms asks, and raises each row when its time is up.
public sealed class RevertKeeper(Func<string, IProtection?> rows, Action<string>? note = null)
{
    /// A row is left this long past its time before the app's own helper raises it, in case the service is gone.
    public const int AppGraceMs = 90_000;

    readonly AutoResetEvent wake = new(false);
    /// When each entry was first seen on this process's own clock, and how long it had left then: a PC clock set back
    /// doesn't put a revert off.
    readonly Dictionary<string, (long At, long Left)> seen = [];
    Thread? thread;
    Ledger? ledger;
    FileSystemWatcher? watcher;
    volatile bool stopping;
    string lastNote = "";

    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public void Start()
    {
        thread = new Thread(Run) { IsBackground = true, Name = "Rig reverts" };
        thread.Start();
    }

    public void Wake() => wake.Set();

    void Run()
    {
        // A revert that came due while the PC was off, or the service wasn't running, is made on the first round.
        string why = "start";
        while (!stopping)
        {
            int wait = Ledger.RetryMs;
            try
            {
                ledger ??= Ledger.Open();
                // Removed with the service (an uninstall): nothing to keep, and nothing to put back in its place.
                if (!Directory.Exists(RecorderPaths.Reverts)) { watcher?.Dispose(); watcher = null; wake.WaitOne(Ledger.IdleMs); continue; }
                Watch();
                var round = ledger.Settle(rows, arms: true, Due, why);
                wait = round.NextMs;
                Say(string.Join("; ", round.Stuck));
            }
            catch (Exception e) { Say(e.Message); }
            why = "due";
            wake.WaitOne(wait);
        }
    }

    bool Due(Revert r) => Due(r, Now, Environment.TickCount64);

    /// `now` is the PC's clock, which can be set; `mono` only ever counts up.
    internal bool Due(Revert r, long now, long mono)
    {
        if (!seen.TryGetValue(r.Id, out var first))
        {
            if (seen.Count > 64) seen.Clear();
            // Never more than the time the person approved, so a clock set back before this start can't stretch it.
            seen[r.Id] = first = (mono, Math.Min(r.DueAt - now, r.Seconds * 1000L));
        }
        return now >= r.DueAt || mono - first.At >= first.Left;
    }

    void Watch()
    {
        if (watcher != null) return;
        try
        {
            watcher = new FileSystemWatcher(RecorderPaths.Reverts, "*.json") { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
            watcher.Created += (_, _) => wake.Set();
            watcher.Renamed += (_, _) => wake.Set();
            watcher.Error += (_, _) => { watcher?.Dispose(); watcher = null; };
            watcher.EnableRaisingEvents = true;
        }
        catch { watcher = null; }
    }

    void Say(string text)
    {
        if (text == lastNote) return;
        lastNote = text;
        if (text.Length > 0) note?.Invoke($"A protection didn't come back on yet, Rig keeps trying: {text}");
    }

    /// Stops watching. With `raise`, every row is raised first: the service is stopping and may not be back.
    public void Stop(bool raise)
    {
        stopping = true;
        wake.Set();
        if (thread != null && thread != Thread.CurrentThread) thread.Join(TimeSpan.FromSeconds(10));
        try { watcher?.Dispose(); } catch { }
        if (!raise || !Directory.Exists(RecorderPaths.Reverts)) return;
        try { Say(string.Join("; ", Ledger.Open().RaiseAll(rows, "stop"))); } catch (Exception e) { Say(e.Message); }
    }
}
