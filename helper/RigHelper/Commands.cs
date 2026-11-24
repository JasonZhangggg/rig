// The general command runner: "command.check", "command.preview",
// "command.apply" and "command.undo" (packages/core/src/change.ts has the
// shapes). The app, its web view and the server are all on the far side of
// the pipe, so nothing they send is trusted:
//
//   preview  checks the command with PowerShell's own parser, runs `read` as
//            the person, and stores the command and its verdict under a
//            nonce that works once and runs out after a few minutes.
//   apply    takes only the nonce. It checks again, takes a snapshot, runs
//            `run` from a file only admins can change, compares the never-list
//            places before and after, and puts everything back on a hit or a
//            failure.
//   undo     takes only the id of an applied change, and runs only what that
//            change's approval covered, with no more rights than it ran with.
//
// A command that needs admin rights runs only after RigHelper.exe
// --approve-command marked its nonce, and that mode only works behind
// Windows' own permission prompt. Everything else runs with the person's own
// rights, so the pipe can't be used to get more than the person already has.
//
// What is stored lives in %ProgramData%\Rig\Commands, which only admins and
// the system can read or change. A helper without admin rights keeps its own
// store under the person's profile and can't run admin commands at all; a
// helper with admin rights never reads that one.

using System.Management;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

public sealed record Pending(string Nonce, string Hash, Command Cmd, bool Tainted, Verdict Verdict, string Person, long ExpiresAt, long ApprovedAt)
{
    public JsonObject ToJson() => new()
    {
        ["nonce"] = Nonce, ["hash"] = Hash, ["cmd"] = Cmd.ToJson(), ["tainted"] = Tainted, ["verdict"] = Verdict.ToJson(),
        ["person"] = Person, ["expiresAt"] = ExpiresAt, ["approvedAt"] = ApprovedAt,
    };

    public static Pending? From(JsonNode? n)
    {
        if (n is not JsonObject o || Command.From(o["cmd"]) is not Command cmd || Verdict.From(o["verdict"]) is not Verdict verdict) return null;
        return new Pending(o["nonce"]?.ToString() ?? "", o["hash"]?.ToString() ?? "", cmd, o["tainted"]?.GetValueKind() != System.Text.Json.JsonValueKind.False, verdict,
            o["person"]?.ToString() ?? "", (long)Json.Num(o["expiresAt"], 0), (long)Json.Num(o["approvedAt"], 0));
    }
}

public sealed class CommandStore
{
    public const int MaxPending = 32, KeepRecordDays = 90;
    public static readonly Regex Id = new("^[0-9a-f]{32}$");
    static readonly SecurityIdentifier Admins = new(WellKnownSidType.BuiltinAdministratorsSid, null), LocalSystem = new(WellKnownSidType.LocalSystemSid, null);

    public string Root { get; }
    readonly bool secured;
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public static string NewId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public static string AdminRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Rig", "Commands");

    /// The store for this process: the admin-only one when it has admin rights, the person's own otherwise.
    public static CommandStore Open() => Native.IsAdmin()
        ? new CommandStore(AdminRoot, secured: true)
        : new CommandStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rig", "Commands"), secured: false);

    public CommandStore(string root, bool secured)
    {
        Root = root;
        this.secured = secured;
        if (secured)
        {
            // ProgramData lets anyone make folders. A parent someone else made is taken over; a store someone else made,
            // or a link in its place, is replaced, so nothing planted there is ever read.
            string parent = Path.GetDirectoryName(root)!;
            if (Directory.Exists(parent) && File.GetAttributes(parent).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(parent);
            if (Directory.Exists(parent) && !OwnedByAdmins(parent)) Lock(parent, new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null));
            if (Directory.Exists(root) && File.GetAttributes(root).HasFlag(FileAttributes.ReparsePoint)) Directory.Delete(root);
            if (Directory.Exists(root) && !OwnedByAdmins(root)) Directory.Delete(root, recursive: true);
            Directory.CreateDirectory(root);
            Lock(root, reader: null);
        }
        foreach (string sub in new[] { "pending", "records", "work", "scripts" }) Directory.CreateDirectory(Path.Combine(root, sub));
    }

    static bool OwnedByAdmins(string dir)
    {
        var owner = new DirectoryInfo(dir).GetAccessControl().GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
        return owner != null && (owner.Equals(Admins) || owner.Equals(LocalSystem));
    }

    /// Admins and the system own and control the folder and all in it; `reader` may read.
    static void Lock(string dir, SecurityIdentifier? reader)
    {
        var sec = new DirectorySecurity();
        sec.SetOwner(Admins);
        sec.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        const InheritanceFlags all = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        sec.AddAccessRule(new FileSystemAccessRule(LocalSystem, FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        sec.AddAccessRule(new FileSystemAccessRule(Admins, FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
        if (reader != null) sec.AddAccessRule(new FileSystemAccessRule(reader, FileSystemRights.ReadAndExecute, all, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(dir).SetAccessControl(sec);
    }

    public string Work => Path.Combine(Root, "work");
    public string RecordDir(string id) => Path.Combine(Root, "records", id);

    /// Where scripts that run as the person are written: the person can read them and only admins can change them.
    public string PersonScripts(string sid)
    {
        string dir = Path.Combine(Root, "scripts", sid);
        Directory.CreateDirectory(dir);
        if (secured) Lock(dir, new SecurityIdentifier(sid));
        return dir;
    }

    static JsonNode? ReadJson(string file)
    {
        try { return JsonNode.Parse(File.ReadAllText(file)); } catch { return null; }
    }

    static void WriteJson(string file, JsonNode node)
    {
        File.WriteAllText(file + ".tmp", node.ToJsonString());
        File.Move(file + ".tmp", file, overwrite: true);
    }

    string PendingFile(string nonce) => Path.Combine(Root, "pending", nonce + ".json");

    public void Save(Pending p)
    {
        var old = new DirectoryInfo(Path.Combine(Root, "pending")).GetFiles().OrderByDescending(f => f.LastWriteTimeUtc).ToList();
        foreach (var f in old.Where((f, i) => i >= MaxPending - 1 || f.LastWriteTimeUtc < DateTime.UtcNow.AddMinutes(-2 * Commands.NonceMinutes)))
            try { f.Delete(); } catch { }
        WriteJson(PendingFile(p.Nonce), p.ToJson());
    }

    /// A stored command that hasn't run out, left in place.
    public Pending? Peek(string nonce) =>
        Id.IsMatch(nonce) && Pending.From(ReadJson(PendingFile(nonce))) is Pending p && p.Nonce == nonce && p.ExpiresAt > Now ? p : null;

    public void Approve(Pending p) => WriteJson(PendingFile(p.Nonce), (p with { ApprovedAt = Now }).ToJson());

    /// Takes a stored command out of the store, so its nonce works once. Null when it is unknown, used or too old.
    public Pending? Take(string nonce)
    {
        if (!Id.IsMatch(nonce)) return null;
        string file = PendingFile(nonce), mine = file + "." + NewId();
        try { File.Move(file, mine); } catch (IOException) { return null; }
        try { return Pending.From(ReadJson(mine)) is Pending p && p.Nonce == nonce && p.ExpiresAt > Now ? p : null; }
        finally { try { File.Delete(mine); } catch { } }
    }

    /// Counts one more tier 2 or 3 change today. False when today's limit is already reached.
    public bool CountToday(int cap)
    {
        string file = Path.Combine(Root, "cap.json"), today = DateTime.Now.ToString("yyyy-MM-dd");
        var o = ReadJson(file);
        int count = o?["day"]?.ToString() == today ? (int)Json.Num(o["count"], cap) : 0;
        if (count >= cap) return false;
        WriteJson(file, new JsonObject { ["day"] = today, ["count"] = count + 1 });
        return true;
    }

    public JsonObject? LastRestorePoint
    {
        get => ReadJson(Path.Combine(Root, "restore.json")) as JsonObject;
        set => WriteJson(Path.Combine(Root, "restore.json"), value!);
    }

    public string NewRecord(string id)
    {
        foreach (var d in new DirectoryInfo(Path.Combine(Root, "records")).GetDirectories().Where(d => d.CreationTimeUtc < DateTime.UtcNow.AddDays(-KeepRecordDays)))
            try { d.Delete(recursive: true); } catch { }
        return Directory.CreateDirectory(RecordDir(id)).FullName;
    }

    public void SaveRecord(string id, JsonObject record) => WriteJson(Path.Combine(RecordDir(id), "record.json"), record);
    public JsonObject? Record(string id) => Id.IsMatch(id) ? ReadJson(Path.Combine(RecordDir(id), "record.json")) as JsonObject : null;
    public void DropRecord(string id) { try { Directory.Delete(RecordDir(id), recursive: true); } catch { } }
}

/// Windows restore points, as a last resort the undo can name. Best effort: at most one a day, and never in the way.
static class RestorePoints
{
    const int WaitMs = 15_000;

    public static bool ProtectionOff()
    {
        using var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore");
        return k?.GetValue("RPSessionInterval") is not int on || on == 0;
    }

    /// The restore point to name for a change made now: one from the last day, or a new one if Windows makes it in time.
    public static JsonObject? Ensure(CommandStore store)
    {
        if (!Native.IsAdmin() || ProtectionOff()) return null;
        if (store.LastRestorePoint is JsonObject last && DateTimeOffset.TryParse(last["at"]?.ToString(), out var at) && at > DateTimeOffset.UtcNow.AddDays(-1)) return last;
        var making = Task.Run(Create);
        if (!making.Wait(WaitMs) || making.Result is not JsonObject made) return null;
        store.LastRestorePoint = made;
        return made.DeepClone().AsObject();
    }

    static JsonObject? Create()
    {
        try
        {
            using var sr = new ManagementClass(@"\\.\root\default:SystemRestore");
            using var args = sr.GetMethodParameters("CreateRestorePoint");
            args["Description"] = "Rig: before a change";
            args["RestorePointType"] = 12;
            args["EventType"] = 100;
            using var done = sr.InvokeMethod("CreateRestorePoint", args, null);
            if (Convert.ToInt64(done["ReturnValue"]) != 0) return null;
            // Windows makes at most one a day by itself; whichever is newest is the one to go back to.
            using var all = new ManagementObjectSearcher(@"root\default", "SELECT SequenceNumber, Description, CreationTime FROM SystemRestore");
            var newest = all.Get().Cast<ManagementBaseObject>().OrderByDescending(p => Convert.ToInt64(p["SequenceNumber"])).FirstOrDefault();
            if (newest == null) return null;
            var made = ManagementDateTimeConverter.ToDateTime(newest["CreationTime"].ToString()).ToUniversalTime();
            return new JsonObject { ["seq"] = Convert.ToInt64(newest["SequenceNumber"]), ["name"] = newest["Description"]?.ToString() ?? "", ["at"] = made.ToString("yyyy-MM-ddTHH:mm:ssZ") };
        }
        catch { return null; }
    }
}

public sealed class Commands(CommandStore store, int? appPid, bool restorePoints = true)
{
    public const int NonceMinutes = 10, DailyCap = 12;
    public const int Expired = 10, Changed = 11;
    const int ParseTimeoutMs = 30_000, ReadTimeoutMs = 20_000, RunTimeoutMs = 120_000;

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;
    static JsonObject Refused(Verdict v) => new() { ["outcome"] = "refused", ["verdict"] = v.ToJson() };
    static JsonObject Refused(string words) => Refused(Verdict.Refuse(words));

    public JsonNode Handle(string method, JsonNode? p) => method switch
    {
        "command.check" => new JsonObject { ["verdict"] = Check(Command.From(p?["cmd"]), Tainted(p)).ToJson() },
        "command.preview" => Preview(Command.From(p?["cmd"]), Tainted(p)),
        "command.apply" => Apply(Str(p?["nonce"]) ?? ""),
        "command.undo" => Undo(Str(p?["id"]) ?? ""),
        _ => throw new RigException($"Rig's helper doesn't know \"{method}\"."),
    };

    /// Anything but a plain false counts as tainted.
    static bool Tainted(JsonNode? p) => p?["tainted"]?.GetValueKind() != System.Text.Json.JsonValueKind.False;

    // ----- Check -----

    /// Runs the fixed parse script over these scripts, with this process's rights and nothing of the person's on its path.
    public IReadOnlyList<JsonNode?> Parse(IReadOnlyList<string> scripts)
    {
        string name = CommandStore.NewId();
        string script = Path.Combine(store.Work, "parse.ps1"), input = Path.Combine(store.Work, name + ".in"), output = Path.Combine(store.Work, name + ".out");
        try
        {
            File.WriteAllText(script, CommandCheck.Resource("Rig.Commands.CommandAst.ps1"), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            File.WriteAllLines(input, scripts.Select(s => Convert.ToBase64String(Encoding.UTF8.GetBytes(s))));
            var ran = PowerShellHost.RunHere(PowerShellHost.Args(script, input, output), ParseTimeoutMs);
            if (!File.Exists(output)) throw new RigException($"PowerShell's parser didn't answer ({(ran.TimedOut ? "it took too long" : ran.Printed.Split('\n')[0].Trim())})");
            return (JsonNode.Parse(File.ReadAllText(output))?["scripts"] as JsonArray ?? []).ToList();
        }
        finally
        {
            try { File.Delete(input); File.Delete(output); } catch { }
        }
    }

    public Verdict Check(Command? cmd, bool tainted)
    {
        try { return CommandCheck.CheckStep(cmd, tainted, Parse); }
        catch (Exception e) { return Verdict.Refuse($"{CommandCheck.Words("unreadable")}: {e.Message}."); }
    }

    // ----- Preview -----

    string Read(Person person, string script)
    {
        string file = Path.Combine(store.PersonScripts(person.Sid), CommandStore.NewId() + ".ps1");
        try
        {
            PowerShellHost.Write(file, script, stopOnError: false);
            var ran = person.Run(file, ReadTimeoutMs);
            return ran.TimedOut ? $"The read didn't finish in {ReadTimeoutMs / 1000} seconds, so Rig stopped it." : ran.Printed;
        }
        finally { try { File.Delete(file); } catch { } }
    }

    JsonObject Preview(Command? cmd, bool tainted)
    {
        var verdict = Check(cmd, tainted);
        if (!verdict.Allowed || cmd == null) return Refused(verdict);
        using var person = Person.Find(appPid);
        // Nothing is approved yet, so everything here is read with the person's rights.
        var states = new TouchStates(person, admin: false);
        var touches = new JsonArray();
        foreach (var t in cmd.Touches)
        {
            string? value;
            try { value = TouchStates.Show(t!, states.Read(t!)); } catch (RigException e) { value = $"Rig couldn't read this as you: {e.Message}."; }
            touches.Add(new JsonObject { ["touch"] = t!.ToJson(), ["value"] = value });
        }
        if (verdict.Tier >= 2 && RestorePoints.ProtectionOff())
            verdict = verdict with { Reasons = [.. verdict.Reasons, "Windows' System Protection is off on this PC, so there will be no restore point to fall back on."] };
        var pending = new Pending(CommandStore.NewId(), cmd.Hash(), cmd, tainted, verdict, person.Sid, DateTimeOffset.UtcNow.AddMinutes(NonceMinutes).ToUnixTimeMilliseconds(), 0);
        string read = Read(person, cmd.Read);
        store.Save(pending);
        return new JsonObject
        {
            ["outcome"] = "ready", ["nonce"] = pending.Nonce, ["expiresAt"] = DateTimeOffset.FromUnixTimeMilliseconds(pending.ExpiresAt).ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            ["verdict"] = verdict.ToJson(), ["read"] = read, ["touches"] = touches,
        };
    }

    /// RigHelper.exe --approve-command <file> --hash <h>: started behind Windows' permission prompt when the person approves
    /// a command that needs admin rights. The file holds {nonce, owner}; the command itself is the one preview stored, and
    /// --hash is its fingerprint as the app showed it. Answers with its exit code only, so it writes nothing where the caller says.
    public static int ApproveFromFile(string file, string? hash, CommandStore? store = null)
    {
        try
        {
            if (!Native.IsAdmin()) return RecorderSetup.NotAdmin;
            var req = JsonNode.Parse(File.ReadAllText(file)) as JsonObject;
            if ((store ?? CommandStore.Open()) is not CommandStore s || s.Peek(Str(req?["nonce"]) ?? "") is not Pending pending) return Expired;
            if (pending.Person != Str(req?["owner"]) || string.IsNullOrEmpty(hash) || !string.Equals(pending.Hash, hash, StringComparison.OrdinalIgnoreCase)) return Changed;
            s.Approve(pending);
            return RecorderSetup.Ok;
        }
        catch { return RecorderSetup.Failed; }
    }

    // ----- Apply -----

    JsonObject Apply(string nonce)
    {
        if (store.Take(nonce) is not Pending pending) return new JsonObject { ["outcome"] = "expired" };
        using var person = Person.Find(appPid);
        if (person.Sid != pending.Person) return new JsonObject { ["outcome"] = "expired" };
        var cmd = pending.Cmd;
        var verdict = Check(cmd, pending.Tainted);
        if (!verdict.Allowed) return Refused(verdict);
        if (verdict.Tier != pending.Verdict.Tier || verdict.Admin != pending.Verdict.Admin) return Refused("Rig's check of this change came out differently than when you looked at it, so nothing ran. Look at it again.");
        if (verdict.Admin)
        {
            if (!Native.IsAdmin()) return Refused("This needs admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then try again. Nothing ran.");
            if (pending.ApprovedAt == 0) return Refused("This needs admin rights, and Windows' permission prompt wasn't answered with Yes for it. Nothing ran.");
            string mine;
            using (var me = WindowsIdentity.GetCurrent()) mine = me.User?.Value ?? "";
            string text = (cmd.Read + cmd.Run + cmd.Undo + string.Concat(cmd.Touches.Select(t => t!.Text))).ToLowerInvariant();
            if (mine != person.Sid && (text.Contains("hkcu") || text.Contains("hkey_current_user")))
                return Refused("This would run as the admin account that answered Windows' prompt, and it changes settings that belong to your own account, which that account can't reach. Nothing ran.");
        }

        string id = CommandStore.NewId(), dir = store.NewRecord(id);
        var states = new TouchStates(person, verdict.Admin);
        var touches = cmd.Touches.Select(t => t!).ToList();
        var before = new List<JsonNode?>();
        for (int i = 0; i < touches.Count; i++)
        {
            try { before.Add(states.Read(touches[i], touches[i].Kind == "file" ? Path.Combine(dir, $"{i}.bin") : null)); }
            catch (RigException e)
            {
                store.DropRecord(id);
                return Refused($"Rig couldn't take a snapshot of {TouchStates.Name(touches[i])} ({e.Message}), so it didn't run this.");
            }
        }
        if (verdict.Tier >= 2 && !store.CountToday(DailyCap))
        {
            store.DropRecord(id);
            return Refused($"Rig has already made {DailyCap} bigger changes on this PC today, which is its daily limit. Nothing ran; try again tomorrow.");
        }
        var point = verdict.Tier >= 2 && restorePoints ? RestorePoints.Ensure(store) : null;
        var watch = new Sentinels(person);
        var guarded = watch.Read();
        string readBefore = Read(person, cmd.Read);

        PowerShellHost.Ran ran;
        string file = Path.Combine(verdict.Admin ? dir : store.PersonScripts(person.Sid), id + "-run.ps1");
        try
        {
            PowerShellHost.Write(file, cmd.Run, stopOnError: true);
            ran = verdict.Admin ? PowerShellHost.RunHere(PowerShellHost.Args(file), RunTimeoutMs) : person.Run(file, RunTimeoutMs);
        }
        finally { try { File.Delete(file); } catch { } }

        var guardedAfter = watch.Read();
        var hits = Sentinels.Differences(guarded, guardedAfter, touches);
        var after = touches.Select(t => { try { return states.Read(t); } catch (RigException) { return null; } }).ToList();
        var result = new JsonObject
        {
            ["before"] = readBefore, ["after"] = Read(person, cmd.Read),
            ["touches"] = new JsonArray(touches.Select((t, i) => (JsonNode)new JsonObject { ["touch"] = t.ToJson(), ["before"] = TouchStates.Show(t, before[i]), ["after"] = TouchStates.Show(t, after[i]) }).ToArray()),
            ["output"] = ran.Printed, ["alsoChanged"] = new JsonArray(),
        };

        if (hits.Count > 0 || !ran.Ok)
        {
            var left = new List<string>();
            for (int i = 0; i < touches.Count; i++) PutBack(states, touches[i], before[i], Path.Combine(dir, $"{i}.bin"), left);
            if (hits.Count > 0)
            {
                watch.PutBack(guarded, guardedAfter, hits, verdict.Admin);
                var now = watch.Read();
                left.AddRange(Sentinels.Hits(guarded, now, Sentinels.Differences(guarded, now, touches)).Select(h => h.After));
            }
            store.DropRecord(id);
            string? error = ran.TimedOut ? $"The change didn't finish in {RunTimeoutMs / 1000} seconds, so Rig stopped it." : ran.Exit != 0 ? $"The change stopped with an error (exit code {ran.Exit})." : null;
            if (left.Count > 0) error = $"{error} Rig couldn't put this back: {string.Join("; ", left)}".Trim();
            var rolled = new JsonObject { ["outcome"] = "rolledBack", ["result"] = result, ["sentinels"] = new JsonArray(Sentinels.Hits(guarded, guardedAfter, hits).Select(h => (JsonNode)h.ToJson()).ToArray()) };
            if (error != null) rolled["error"] = error;
            return rolled;
        }

        store.SaveRecord(id, new JsonObject
        {
            ["id"] = id, ["person"] = person.Sid, ["admin"] = verdict.Admin, ["at"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["cmd"] = cmd.ToJson(),
            ["before"] = new JsonArray(before.Select(s => s?.DeepClone()).ToArray()), ["after"] = new JsonArray(after.Select(s => s?.DeepClone()).ToArray()),
            ["restorePoint"] = point?.DeepClone(),
        });
        var undo = new JsonObject { ["kind"] = "command", ["id"] = id };
        if (cmd.Undo != null) undo["script"] = cmd.Undo;
        if (point != null) undo["restorePoint"] = point;
        undo["outside"] = new JsonArray();
        undo["fingerprint"] = Fingerprint(after);
        return new JsonObject { ["outcome"] = "applied", ["result"] = result, ["undo"] = undo };
    }

    static string Fingerprint(IEnumerable<JsonNode?> states) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", states.Select(s => s?.ToJsonString() ?? "null"))))).ToLowerInvariant();

    static bool Same(JsonNode? a, JsonNode? b) => (a?.ToJsonString() ?? "null") == (b?.ToJsonString() ?? "null");

    /// Puts one touch back as it was, unless it already is. What it couldn't do goes on `left`.
    static void PutBack(TouchStates states, Touch t, JsonNode? was, string copy, List<string> left)
    {
        if (was == null) return;
        try
        {
            if (!Same(states.Read(t), was)) states.Write(t, was, copy);
        }
        catch (RigException e) { left.Add($"{TouchStates.Name(t)} ({e.Message})"); }
    }

    // ----- Undo -----

    JsonObject Undo(string id)
    {
        var unknown = new JsonObject { ["outcome"] = "unknown" };
        if (store.Record(id) is not JsonObject rec || Command.From(rec["cmd"]) is not Command cmd || rec["undone"] != null) return unknown;
        using var person = Person.Find(appPid);
        if (person.Sid != rec["person"]?.ToString()) return unknown;
        bool admin = rec["admin"]?.GetValue<bool>() == true;
        var point = rec["restorePoint"]?.DeepClone();
        JsonObject Failed(string error)
        {
            var o = new JsonObject { ["outcome"] = "failed", ["error"] = error };
            if (point != null) o["restorePoint"] = point;
            return o;
        }
        if (admin && !Native.IsAdmin()) return Failed("This change was made with admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then undo again.");

        var states = new TouchStates(person, admin);
        var touches = cmd.Touches.Select(t => t!).ToList();
        var before = rec["before"]!.AsArray();
        var after = rec["after"]!.AsArray();
        var drifted = new List<string>();
        var failed = new List<string>();
        var stuck = new List<string>();
        var mine = new List<int>();
        for (int i = 0; i < touches.Count; i++)
        {
            if (before[i] == null) continue;
            JsonNode? now;
            try { now = states.Read(touches[i]); } catch (RigException e) { failed.Add($"{TouchStates.Name(touches[i])} ({e.Message})"); continue; }
            // Still as Rig left it, or already back: Rig's to put back. Anything else was changed since, and stays.
            if (Same(now, after[i]) || Same(now, before[i])) mine.Add(i);
            else drifted.Add($"{TouchStates.Name(touches[i])} was changed again after Rig's change, so Rig left it as it is");
        }
        void Restore()
        {
            stuck.Clear();
            foreach (int i in mine) PutBack(states, touches[i], before[i], Path.Combine(store.RecordDir(id), $"{i}.bin"), stuck);
        }
        Restore();

        string? scriptProblem = null;
        if (cmd.Undo != null && drifted.Count > 0) drifted.Add("the undo script wasn't run, because it could undo the later change too");
        else if (cmd.Undo != null)
        {
            // The undo script was approved with the command. It runs with the rights the change ran with, never more.
            var verdict = Check(cmd, tainted: false);
            if (!verdict.Allowed || (verdict.Admin && !admin)) scriptProblem = "Rig's rules no longer allow the undo script, so it wasn't run";
            else
            {
                string file = Path.Combine(admin ? store.RecordDir(id) : store.PersonScripts(person.Sid), id + "-undo.ps1");
                try
                {
                    PowerShellHost.Write(file, cmd.Undo, stopOnError: false);
                    var ran = admin ? PowerShellHost.RunHere(PowerShellHost.Args(file), RunTimeoutMs) : person.Run(file, RunTimeoutMs);
                    if (!ran.Ok) scriptProblem = ran.TimedOut ? "the undo script didn't finish" : $"the undo script stopped with an error: {ran.Printed.Split('\n')[0].Trim()}";
                }
                finally { try { File.Delete(file); } catch { } }
                // The snapshot has the last word on what it covers.
                Restore();
            }
        }

        // Without a snapshot of everything, the undo script was the only way back for the rest.
        failed.AddRange(stuck);
        if (scriptProblem != null && touches.Any(t => !t.Snapshotted)) failed.Add(scriptProblem);
        if (failed.Count > 0) return Failed($"Rig couldn't put everything back: {string.Join("; ", failed)}.");
        rec["undone"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        store.SaveRecord(id, rec);
        return new JsonObject { ["outcome"] = "undone", ["printed"] = Read(person, cmd.Read), ["left"] = new JsonArray(drifted.Select(d => (JsonNode)d).ToArray()) };
    }

    // ----- Self-test -----

    /// Run by --selftest on a real Windows PC: the vectors through the real parser, then real changes under
    /// HKCU\Software\RigSelftest (and HKLM\SOFTWARE\RigSelftest with admin rights), each put back.
    public static List<string> SelfChecks()
    {
        const string key = @"Software\RigSelftest", runKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        var problems = new List<string>();
        bool elevated = Native.IsAdmin();
        string root = elevated ? CommandStore.AdminRoot + "-selftest-" + CommandStore.NewId() : Path.Combine(Path.GetTempPath(), "rig-selftest-commands-" + CommandStore.NewId());
        void Expect(bool ok, string problem) { if (!ok) problems.Add(problem); }
        static object? Value(RegistryKey hive, string path, string name) { using var k = hive.OpenSubKey(path); return k?.GetValue(name); }
        static bool Exists(RegistryKey hive, string path) { using var k = hive.OpenSubKey(path); return k != null; }
        try
        {
            var store = new CommandStore(root, secured: elevated);
            var rig = new Commands(store, appPid: null, restorePoints: false);
            JsonNode Call(string method, JsonObject p) => rig.Handle(method, p);
            JsonNode Preview(JsonObject cmd) => Call("command.preview", new JsonObject { ["cmd"] = cmd, ["tainted"] = false });
            JsonNode ApplyNonce(JsonNode preview) => Call("command.apply", new JsonObject { ["nonce"] = preview["nonce"]?.ToString() });

            // Every shared vector, through the real parser.
            var vectors = JsonNode.Parse(CommandCheck.Resource("Rig.Rules.vectors.json"))!.AsArray();
            var texts = vectors.Select(v => v!["script"]!.ToString()).Where(s => CommandCheck.Precheck(s) == null).Distinct().ToList();
            var parsed = rig.Parse(texts);
            Expect(parsed.Count == texts.Count, $"the parser answered for {parsed.Count} of {texts.Count} vector scripts");
            int wrong = 0;
            foreach (var v in vectors)
            {
                string script = v!["script"]!.ToString(), use = v["as"]!.ToString();
                int at = texts.IndexOf(script);
                var got = CommandCheck.CheckScript(script, use, at >= 0 && at < parsed.Count ? parsed[at] : null);
                var want = v["expect"]!;
                string? off = want["refused"] != null ? (got.Allowed ? $"allowed at tier {got.Tier}" : got.Refused.Length <= 20 ? "refused without saying why" : null)
                    : !got.Allowed ? $"refused: {got.Refused}"
                    : want["tier"] != null && (int)Json.Num(want["tier"], -1) != got.Tier ? $"tier {got.Tier}" : null;
                if (off == null && want["commands"] is JsonArray names && !names.Select(n => n!.ToString().ToLowerInvariant()).SequenceEqual(got.Commands.Select(c => c.Name.ToLowerInvariant())))
                    off = $"commands {string.Join(", ", got.Commands.Select(c => c.Name))}";
                if (off != null && ++wrong <= 5) problems.Add($"command vector [{use}] {script} gave {off}");
            }
            Expect(wrong <= 5, $"{wrong} command vectors gave the wrong verdict");

            // The fingerprint an approval is of is the one the app works out (packages/core/test/check.test.ts holds the same value).
            var menus = new Command("Makes menus open faster.", @"Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay",
                @"Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay -Value 100", @"Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name MenuShowDelay -Value 400",
                [new Touch("registry", @"HKCU\Control Panel\Desktop", "MenuShowDelay")]);
            Expect(menus.Hash() == "684001665991492c95d668bca82a394c0671daabf81b71ae978766d18c07e053", "a command's fingerprint differs from the app's");

            // A harmless change of the person's own: preview, apply, verify, undo back to absent.
            var harmless = new JsonObject
            {
                ["does"] = "Sets a test value.",
                ["read"] = @"Get-ItemProperty -Path 'HKCU:\Software\RigSelftest' -Name Flag -ErrorAction SilentlyContinue",
                ["run"] = @"New-Item -Path 'HKCU:\Software\RigSelftest' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\RigSelftest' -Name Flag -Value 1",
                ["undo"] = @"Remove-ItemProperty -Path 'HKCU:\Software\RigSelftest' -Name Flag -ErrorAction SilentlyContinue",
                ["touches"] = new JsonArray(new JsonObject { ["kind"] = "registry", ["key"] = @"HKCU\Software\RigSelftest", ["value"] = "Flag" }),
            };
            Expect(Call("command.check", new JsonObject { ["cmd"] = harmless.DeepClone(), ["tainted"] = false })["verdict"]?["status"]?.ToString() == "allowed", "command.check refused the harmless command");
            var p1 = Preview(harmless.DeepClone().AsObject());
            Expect(p1["outcome"]?.ToString() == "ready" && p1["verdict"]?["admin"]?.GetValue<bool>() == false, $"the harmless command's preview wasn't ready: {p1.ToJsonString()}");
            Expect(p1["touches"] is JsonArray { Count: 1 } shown && shown[0]!["value"] == null, "the preview didn't show the test value as absent");
            Expect(!Exists(Registry.CurrentUser, key), "a preview changed the registry");
            var a1 = ApplyNonce(p1);
            Expect(a1["outcome"]?.ToString() == "applied", $"the harmless command wasn't applied: {a1.ToJsonString()}");
            Expect(Value(Registry.CurrentUser, key, "Flag") is 1, "the harmless command didn't write its value");
            Expect(a1["result"]?["touches"]?[0]?["before"] == null && a1["result"]?["touches"]?[0]?["after"]?.ToString() == "1", "apply didn't report the value before and after");
            Expect(a1["result"]?["before"]?.ToString().Contains("Flag") == false && a1["result"]?["after"]?.ToString().Contains("Flag") == true, $"running read again didn't show the change: {a1["result"]?.ToJsonString()}");
            Expect(ApplyNonce(p1)["outcome"]?.ToString() == "expired", "a nonce worked twice");
            string id = a1["undo"]?["id"]?.ToString() ?? "";
            var u1 = Call("command.undo", new JsonObject { ["id"] = id });
            Expect(u1["outcome"]?.ToString() == "undone" && u1["left"] is JsonArray { Count: 0 }, $"undo didn't finish cleanly: {u1.ToJsonString()}");
            Expect(!Exists(Registry.CurrentUser, key), "undo didn't put the test key back to absent");
            Expect(Call("command.undo", new JsonObject { ["id"] = id })["outcome"]?.ToString() == "unknown", "a change could be undone twice");
            Expect(Call("command.apply", new JsonObject { ["nonce"] = CommandStore.NewId() })["outcome"]?.ToString() == "expired", "a made-up nonce wasn't answered expired");

            // Undo leaves alone what someone changed after Rig did.
            var a2 = ApplyNonce(Preview(harmless.DeepClone().AsObject()));
            using (var k = Registry.CurrentUser.CreateSubKey(key)) k.SetValue("Flag", 7);
            var u2 = Call("command.undo", new JsonObject { ["id"] = a2["undo"]?["id"]?.ToString() });
            Expect(u2["outcome"]?.ToString() == "undone" && u2["left"] is JsonArray { Count: > 0 } && Value(Registry.CurrentUser, key, "Flag") is 7, $"undo overwrote a later change: {u2.ToJsonString()}");
            Registry.CurrentUser.DeleteSubKeyTree(key, throwOnMissingSubKey: false);

            // Its touches look harmless and the check can't see the path it builds, but it writes a Run key: caught and put back.
            var sneaky = new JsonObject
            {
                ["does"] = "Sets a test value.",
                ["read"] = @"Get-ItemProperty -Path 'HKCU:\Software\RigSelftest' -ErrorAction SilentlyContinue",
                ["run"] = @"New-Item -Path 'HKCU:\Software\RigSelftest' -Force | Out-Null; $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\{0}' -f 'Run'; if (-not (Test-Path $k)) { New-Item -Path $k | Out-Null }; Set-ItemProperty -Path $k -Name RigSelftest -Value 'rig-selftest'",
                ["touches"] = new JsonArray(new JsonObject { ["kind"] = "registry", ["key"] = @"HKCU\Software\RigSelftest" }),
            };
            var p3 = Preview(sneaky);
            Expect(p3["outcome"]?.ToString() == "ready", $"the Run key test was refused before it ran, so the sentinels weren't tested: {p3.ToJsonString()}");
            var a3 = ApplyNonce(p3);
            Expect(a3["outcome"]?.ToString() == "rolledBack" && a3["sentinels"] is JsonArray hit && hit.Any(h => h?["sentinel"]?.ToString() == "run" && h["after"]?.ToString().Contains("rig-selftest") == true),
                $"a write to the Run key wasn't reported as a sentinel hit: {a3.ToJsonString()}");
            Expect(Value(Registry.CurrentUser, runKey, "RigSelftest") == null, "the Run value was left behind after the rollback");
            Expect(!Exists(Registry.CurrentUser, key), "the rollback left the test key behind");
            Expect(a3["error"] == null, $"the rollback reported something left over: {a3["error"]}");

            // A failed change is rolled back from the snapshot.
            var failing = harmless.DeepClone().AsObject();
            failing["run"] = harmless["run"]!.ToString() + "; throw 'stop here'";
            var a4 = ApplyNonce(Preview(failing));
            Expect(a4["outcome"]?.ToString() == "rolledBack" && a4["error"] != null && !Exists(Registry.CurrentUser, key), $"a change that failed wasn't rolled back: {a4.ToJsonString()}");

            if (elevated)
            {
                Expect(!new DirectoryInfo(root).GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
                    .Any(r => r.IdentityReference.Value is not ("S-1-5-18" or "S-1-5-32-544")), "the command store can be reached by more than admins and the system");

                // A command that needs admin rights runs only once --approve-command has marked its nonce, with the right fingerprint.
                var system = new JsonObject
                {
                    ["does"] = "Sets a test value for all accounts.",
                    ["read"] = @"Get-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name Flag -ErrorAction SilentlyContinue",
                    ["run"] = @"New-Item -Path 'HKLM:\SOFTWARE\RigSelftest' -Force | Out-Null; Set-ItemProperty -Path 'HKLM:\SOFTWARE\RigSelftest' -Name Flag -Value 1",
                    ["touches"] = new JsonArray(new JsonObject { ["kind"] = "registry", ["key"] = @"HKLM\SOFTWARE\RigSelftest" }),
                };
                string me;
                using (var who = WindowsIdentity.GetCurrent()) me = who.User!.Value;
                string hash = Command.From(system)!.Hash(), request = Path.Combine(store.Work, "approve.json");
                var p5 = Preview(system.DeepClone().AsObject());
                Expect(p5["verdict"]?["admin"]?.GetValue<bool>() == true, "a change under HKLM wasn't marked as needing admin rights");
                Expect(ApplyNonce(p5)["outcome"]?.ToString() == "refused" && !Exists(Registry.LocalMachine, @"SOFTWARE\RigSelftest"), "an admin command ran without Windows' prompt");
                var p6 = Preview(system.DeepClone().AsObject());
                File.WriteAllText(request, new JsonObject { ["nonce"] = p6["nonce"]?.ToString(), ["owner"] = me }.ToJsonString());
                Expect(ApproveFromFile(request, new string('0', 64), store) == Changed, "an approval with the wrong fingerprint was accepted");
                Expect(ApproveFromFile(request, hash, store) == RecorderSetup.Ok, "an approval with the right fingerprint was turned down");
                var a6 = ApplyNonce(p6);
                Expect(a6["outcome"]?.ToString() == "applied" && Value(Registry.LocalMachine, @"SOFTWARE\RigSelftest", "Flag") is 1, $"an approved admin command didn't run: {a6.ToJsonString()}");
                var u6 = Call("command.undo", new JsonObject { ["id"] = a6["undo"]?["id"]?.ToString() });
                Expect(u6["outcome"]?.ToString() == "undone" && !Exists(Registry.LocalMachine, @"SOFTWARE\RigSelftest"), $"undo didn't remove the admin test key: {u6.ToJsonString()}");
            }

            // The daily limit on bigger changes holds whatever the app asks for.
            int counted = 0;
            while (counted <= DailyCap && store.CountToday(DailyCap)) counted++;
            Expect(counted < DailyCap && !store.CountToday(DailyCap), "the daily limit on bigger changes doesn't hold");
        }
        catch (Exception e) { problems.Add($"the command checks stopped: {e}"); }
        finally
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(key, throwOnMissingSubKey: false); } catch { }
            try { using var run = Registry.CurrentUser.OpenSubKey(runKey, writable: true); run?.DeleteValue("RigSelftest", throwOnMissingValue: false); } catch { }
            if (elevated) try { Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\RigSelftest", throwOnMissingSubKey: false); } catch { }
            try { Directory.Delete(root, recursive: true); } catch { }
            try { string parent = Path.GetDirectoryName(root)!; if (elevated && !Directory.EnumerateFileSystemEntries(parent).Any()) Directory.Delete(parent); } catch { }
        }
        return problems;
    }
}
