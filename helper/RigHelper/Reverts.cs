// The revert ledger: which protections Rig turned off for a while, and when
// each comes back on. It is one small file, reverts.json, in a folder only
// admins and the system can read or change, with reverts.log beside it for
// what became of each entry.
//
//   The helper, with admin rights and an approved step, adds an entry before
//   it turns a protection off, and waits for Rig's background service to mark
//   it armed. No mark, no change: the entry is taken out again and nothing is
//   turned off.
//
//   The service (RecorderService.cs, LocalSystem) looks at the ledger every
//   second. It marks new entries armed, and when an entry is due it turns
//   that row back on, reads it back, writes the log and drops the entry. An
//   entry that came due while the PC was off is due when the service starts.
//   Stopping or removing the service turns everything in the ledger back on
//   first.
//
// All the service ever takes from the ledger is a row's id and a time. What
// turning a row back on means is Protections.cs' own code, so nothing written
// here, by anyone, can make the service do more than turn a protection on.
// The service runs no script and no step's undo.

using System.Diagnostics;
using System.ServiceProcess;
using System.Text.Json.Nodes;

namespace Rig.Helper;

/// One entry: the row, when it comes back on, and when the service took it on (0 until it has). Times are Unix milliseconds.
public sealed record Revert(string Row, long Due, long Armed);

public static class Reverts
{
    const int AckWaitMs = 10_000, LockWaitMs = 5_000, RetryMs = 60_000, MaxLogBytes = 256 * 1024;

    public const string NoService = "Rig's background recorder isn't running, and it is what turns a protection back on, so Rig won't turn this off. Turn the recorder on in Rig's Settings, then ask again.";
    const string NoAnswer = "Rig's background recorder didn't take on turning this back on, so Rig didn't turn it off. Restart the PC, or turn the recorder off and on in Rig's Settings, then ask again.";

    /// Where the ledger is, and the service that keeps it. The self-test points both at its own.
    internal static string Dir { get; set; } = Path.Combine(Path.GetDirectoryName(CommandStore.AdminRoot)!, "Reverts");
    internal static string Service { get; set; } = RecorderPaths.ServiceName;

    static string Ledger => Path.Combine(Dir, "reverts.json");
    static string Log => Path.Combine(Dir, "reverts.log");
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// The helper and the service take turns: whoever holds reverts.lock open reads and rewrites the ledger.
    static T Locked<T>(Func<T> work)
    {
        var waited = Stopwatch.StartNew();
        while (true)
        {
            try
            {
                using var mine = new FileStream(Path.Combine(Dir, "reverts.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                return work();
            }
            catch (IOException) when (Directory.Exists(Dir) && waited.ElapsedMilliseconds < LockWaitMs) { Thread.Sleep(50); }
        }
    }

    static List<Revert> Read()
    {
        if (!File.Exists(Ledger)) return [];
        JsonArray? entries;
        try { entries = JsonNode.Parse(File.ReadAllText(Ledger)) as JsonArray; } catch (System.Text.Json.JsonException) { entries = null; }
        // A ledger that can't be read is read as every row being due: turning a protection on is the safe mistake.
        if (entries == null) return Protections.Rows.Select(r => new Revert(r.Id, 0, 0)).ToList();
        return entries.Select(e => new Revert(e?["row"]?.ToString() ?? "", (long)Json.Num(e?["due"], 0), (long)Json.Num(e?["armed"], 0))).ToList();
    }

    /// Replaces the ledger in one move, written through to the disk first, so losing power leaves the old one or the new one.
    static void Write(IEnumerable<Revert> entries)
    {
        var list = new JsonArray(entries.Select(e => (JsonNode)new JsonObject { ["row"] = e.Row, ["due"] = e.Due, ["armed"] = e.Armed }).ToArray());
        if (list.Count == 0) { File.Delete(Ledger); return; }
        using (var tmp = new FileStream(Ledger + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None))
        {
            tmp.Write(System.Text.Encoding.UTF8.GetBytes(list.ToJsonString()));
            tmp.Flush(flushToDisk: true);
        }
        File.Move(Ledger + ".tmp", Ledger, overwrite: true);
    }

    /// One line for what ended an entry. `why`: due, start (due while the PC was off), stop, uninstall, kept or undone.
    /// `was`: how the service found the row: off (and turned it back on), on already, or stuck off.
    static void Logged(Revert e, string why, string? was)
    {
        if (File.Exists(Log) && new FileInfo(Log).Length > MaxLogBytes) File.Delete(Log);
        var line = new JsonObject { ["t"] = Now, ["row"] = e.Row, ["due"] = e.Due, ["why"] = why };
        if (was != null) line["was"] = was;
        File.AppendAllText(Log, line.ToJsonString() + "\n");
    }

    public static IReadOnlyList<Revert> All()
    {
        try { return Directory.Exists(Dir) ? Locked(Read) : []; }
        catch (UnauthorizedAccessException) { throw new RigException("This needs admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then try again."); }
    }
    public static Revert? Find(string row) => All().FirstOrDefault(e => e.Row == row);

    /// The newest log line about a row.
    public static JsonObject? Last(string row)
    {
        if (!File.Exists(Log)) return null;
        foreach (string line in File.ReadAllLines(Log).Reverse())
        {
            try { if (JsonNode.Parse(line) is JsonObject o && o["row"]?.ToString() == row) return o; } catch (System.Text.Json.JsonException) { }
        }
        return null;
    }

    // ----- The helper's side -----

    public static bool ServiceRunning()
    {
        try { using var sc = new ServiceController(Service); return sc.Status == ServiceControllerStatus.Running; }
        catch (InvalidOperationException) { return false; }
    }

    /// Has the service take on turning `row` back on at `due`, and waits for it to say it has. Null when it did; else why
    /// not, in plain words, with the ledger as it was.
    public static string? Arm(string row, long due)
    {
        CommandStore.Secure(Dir);
        bool Mine(Revert e) => e.Row == row && e.Due == due;
        Locked(() => { Write([.. Read().Where(e => e.Row != row), new Revert(row, due, 0)]); return true; });
        for (var waited = Stopwatch.StartNew(); waited.ElapsedMilliseconds < AckWaitMs; Thread.Sleep(200))
            if (All().Any(e => Mine(e) && e.Armed > 0)) return null;
        Locked(() => { Write(Read().Where(e => !Mine(e))); return true; });
        return NoAnswer;
    }

    /// Takes a row out of the ledger: the person chose to keep it off, or the helper turned it back on itself.
    /// `why` goes in the log; null when nothing was ever turned off.
    public static void Drop(string row, string? why)
    {
        if (!Directory.Exists(Dir)) return;
        Locked(() =>
        {
            var all = Read();
            foreach (var e in all.Where(e => e.Row == row)) if (why != null) Logged(e, why, null);
            Write(all.Where(e => e.Row != row));
            return true;
        });
    }

    // ----- The service's side -----

    /// Turns a row back on and reads it back: "on" when it already was, "off" when it was off and is on now, "stuck" when
    /// it still reads off or this version doesn't know the row.
    static string Raise(string id)
    {
        if (Protections.Find(id) is not Protection row) return "stuck";
        try
        {
            if (Protections.On(row)) return "on";
            Protections.Set(row, true);
            return Protections.Settled(row, true) ? "off" : "stuck";
        }
        catch (RigException) { return "stuck"; }
    }

    /// Only a ledger admins or the system made is read: ProgramData lets anyone make a folder before Rig does.
    static bool Usable() => File.Exists(Ledger) && AdminFile.TrustedTree(Dir);

    /// Runs in the service until it stops: marks new entries armed and turns back on what is due.
    public static void Keep(CancellationToken stop)
    {
        var retryAt = new Dictionary<string, long>();
        for (string why = "start"; ; why = "due")
        {
            try { if (Usable()) Locked(() => Round(why, retryAt)); } catch (Exception) { }
            if (stop.WaitHandle.WaitOne(1000)) return;
        }
    }

    static bool Round(string why, Dictionary<string, long> retryAt)
    {
        var all = Read();
        var keep = new List<Revert>();
        foreach (var e in all)
        {
            // An entry for a row this version doesn't know is never marked, so nothing is turned off on its word.
            if (e.Due > Now) { keep.Add(e.Armed == 0 && Protections.Find(e.Row) != null ? e with { Armed = Now } : e); continue; }
            if (retryAt.TryGetValue(e.Row, out long again) && Now < again) { keep.Add(e); continue; }
            string was = Raise(e.Row);
            if (was == "stuck")
            {
                // Still off: said once, and tried again every minute until it holds.
                if (!retryAt.ContainsKey(e.Row)) Logged(e, why, was);
                retryAt[e.Row] = Now + RetryMs;
                keep.Add(e);
                continue;
            }
            retryAt.Remove(e.Row);
            Logged(e, why, was);
        }
        if (!keep.SequenceEqual(all)) Write(keep);
        return true;
    }

    /// Turns back on everything in the ledger now, whatever its time: the service is stopping or being removed. With
    /// `forget` the ledger and its folder go too; without, a row that wouldn't turn back on stays for the next start.
    public static void RaiseAll(string why, bool forget = false)
    {
        try
        {
            if (Usable())
                Locked(() =>
                {
                    var stuck = new List<Revert>();
                    foreach (var e in Read())
                    {
                        string was = Raise(e.Row);
                        Logged(e, why, was);
                        if (was == "stuck") stuck.Add(e);
                    }
                    Write(forget ? [] : stuck);
                    return true;
                });
            if (forget && Directory.Exists(Dir) && !File.GetAttributes(Dir).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(Dir, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or RigException or System.Text.Json.JsonException) { }
    }
}
