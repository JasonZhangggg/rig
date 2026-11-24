// The general command: command.check, command.preview, command.apply and
// command.undo, with the request and reply shapes in packages/core/src/change.ts.
// The helper owns approval. Preview stores the command and its verdict under a
// nonce that works once and expires; apply takes only the nonce, checks again,
// snapshots what the command touches, reads the sentinels, runs it pinned,
// verifies with `read`, and rolls back on a never-list write or a failed run.
// Undo restores the snapshot, then runs the stored undo script, then names the
// restore point. A command that needs admin rights runs only after
// RigHelper --approve-command, started behind Windows' own prompt, marked its nonce.

using System.Management;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Rig.Helper;

public sealed class CommandRunner(Person person, bool restorePoints = true)
{
    public const int NonceMinutes = 10, DailyCap = 8;
    const int ReadTimeoutMs = 30_000, RunTimeoutMs = 600_000;
    static readonly Regex NonceRe = new("^[0-9a-f]{32}$"), IdRe = new("^[au]-[0-9a-f]{24}$");
    static readonly UTF8Encoding Bom = new(encoderShouldEmitUTF8Identifier: true);

    /// The nonces this helper gave out and the fingerprint of the command each is for. A pending file this helper didn't write never runs.
    readonly Dictionary<string, string> issued = [];

    static bool Flag(JsonNode? n, bool fallback) => n is JsonValue v && v.TryGetValue(out bool b) ? b : fallback;
    static string? Text(JsonNode? n) => n is JsonValue v && v.TryGetValue(out string? s) ? s : null;
    static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static string Clip(string s) => s.Length <= PinnedShell.MaxOutput ? s : s[..PinnedShell.MaxOutput] + "\n...";
    static JsonArray Strings(IEnumerable<string> list) => new(list.Select(x => (JsonNode)x).ToArray());

    public JsonNode Handle(string method, JsonNode? p) => method switch
    {
        // A request that doesn't say whether the chat read outside text is treated as one that did.
        "command.check" => new JsonObject { ["verdict"] = CommandCheck.Command(p?["cmd"], Flag(p?["tainted"], true)).Verdict },
        "command.preview" => Preview(p?["cmd"], Flag(p?["tainted"], true)),
        "command.apply" => Apply(Text(p?["nonce"]) ?? ""),
        "command.undo" => Undo(Text(p?["id"]) ?? ""),
        _ => throw new RigException($"Rig's helper doesn't know \"{method}\"."),
    };

    SnapshotContext Context(bool admin) => new(person, admin && Native.IsAdmin());

    /// Runs a script as a file in a folder only admins can change: elevated here, or as the person, who may read their folder and no more.
    PinnedShell.Ran Run(string script, bool elevated, int timeoutMs)
    {
        string dir = elevated ? CommandHome.Folder("run") : CommandHome.Folder("person", person.Sid);
        string file = Path.Combine(dir, $"{RandomNumberGenerator.GetHexString(16, lowercase: true)}.ps1");
        File.WriteAllText(file, script, Bom);
        try { return elevated ? PinnedShell.RunHere(file, timeoutMs) : PinnedShell.RunAs(person, file, timeoutMs); }
        finally { try { File.Delete(file); } catch (IOException) { } }
    }

    /// What `read` prints now, run as the person without admin rights. When that can't be done, it says so instead of looking another way.
    string Look(JsonObject cmd)
    {
        try
        {
            var ran = Run(Text(cmd["read"])!, elevated: false, ReadTimeoutMs);
            return Clip(ran.TimedOut ? "Rig stopped the read script after 30 seconds." : ran.Text);
        }
        catch (Exception e) when (e is RigException or System.ComponentModel.Win32Exception)
        {
            return $"Rig didn't look: {(e is RigException ? e.Message : $"it couldn't run the read script as you ({e.Message})")}";
        }
    }

    JsonObject Preview(JsonNode? given, bool tainted)
    {
        var (verdict, cmd) = CommandCheck.Command(given, tainted);
        if (cmd == null) return new JsonObject { ["outcome"] = "refused", ["verdict"] = verdict };
        if (CommandCheck.Tier(verdict) >= 2 && restorePoints && RestorePoints.Off() is string off) verdict["reasons"]!.AsArray().Add($"{off}.");

        var ctx = Context(CommandCheck.Admin(verdict));
        var touches = new JsonArray();
        foreach (var t in cmd["touches"]!.AsArray())
            touches.Add(new JsonObject { ["touch"] = t!.DeepClone(), ["value"] = Snapshot.Show(Snapshot.Read(t.AsObject(), ctx)) });

        string nonce = RandomNumberGenerator.GetHexString(32, lowercase: true), hash = CommandCheck.Fingerprint(cmd);
        long expires = Now + NonceMinutes * 60_000L;
        var pending = new JsonObject
        {
            ["nonce"] = nonce, ["hash"] = hash, ["expires"] = expires, ["person"] = person.Sid, ["tainted"] = tainted,
            ["cmd"] = cmd.DeepClone(), ["verdict"] = verdict.DeepClone(), ["approved"] = false,
        };
        string dir = CommandHome.Folder("pending");
        foreach (string old in Directory.GetFiles(dir, "*.json"))
            if (File.GetLastWriteTimeUtc(old) < DateTime.UtcNow.AddMinutes(-2 * NonceMinutes)) try { File.Delete(old); } catch (IOException) { }
        File.WriteAllText(Path.Combine(dir, $"{nonce}.json"), pending.ToJsonString());
        issued[nonce] = hash;
        return new JsonObject
        {
            ["outcome"] = "ready", ["nonce"] = nonce, ["expiresAt"] = DateTimeOffset.FromUnixTimeMilliseconds(expires).ToString("o"),
            ["verdict"] = verdict, ["read"] = Look(cmd), ["touches"] = touches,
        };
    }

    /// RigHelper.exe --approve-command <file> --hash <h>: run behind Windows' permission prompt when the person approves a command
    /// that needs admin rights. The file holds {nonce, cmd, owner}; --hash is the command's fingerprint as the app showed it. The nonce
    /// is marked approved only when the file, the hash and the command the helper stored at preview all agree. The result is written next to the file.
    public static int ApproveFromFile(string file, string? hash)
    {
        string result = file + ".result";
        try
        {
            if (!Native.IsAdmin()) return RecorderSetup.NotAdmin;
            var req = JsonNode.Parse(File.ReadAllText(file)) as JsonObject ?? throw new RigException("Rig couldn't read the command to approve.");
            string nonce = Text(req["nonce"]) ?? "";
            if (!NonceRe.IsMatch(nonce)) throw new RigException("Rig couldn't tell which command to approve.");
            var shown = CommandCheck.Canonical(req["cmd"], out _)?.Command ?? throw new RigException("Rig couldn't read the command to approve.");
            if (string.IsNullOrEmpty(hash) || !string.Equals(CommandCheck.Fingerprint(shown), hash, StringComparison.OrdinalIgnoreCase))
                throw new RigException("The command changed after you chose Approve, so Rig didn't approve it.");
            string path = Path.Combine(CommandHome.Folder("pending"), $"{nonce}.json");
            var pending = (File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject : null) ?? throw new RigException("That approval ran out. Ask Rig for the change again.");
            if (Json.Num(pending["expires"], 0) < Now) throw new RigException("That approval ran out. Ask Rig for the change again.");
            if (!string.Equals(Text(pending["hash"]), hash, StringComparison.OrdinalIgnoreCase) || Text(pending["person"]) != Text(req["owner"]))
                throw new RigException("This isn't the command Rig showed you, so Rig didn't approve it.");
            pending["approved"] = true;
            File.WriteAllText(path, pending.ToJsonString());
            File.WriteAllText(result, new JsonObject { ["ok"] = true }.ToJsonString());
            return RecorderSetup.Ok;
        }
        catch (Exception e)
        {
            try { File.WriteAllText(result, new JsonObject { ["ok"] = false, ["error"] = e is RigException ? e.Message : $"Rig couldn't approve the command: {e.Message}" }.ToJsonString()); } catch { }
            return RecorderSetup.Failed;
        }
    }

    static JsonObject Refused(string words, JsonObject? verdict = null) =>
        new() { ["outcome"] = "refused", ["verdict"] = CommandCheck.Refuse(words, "refused", verdict?["commands"]?.DeepClone() as JsonArray) };

    JsonObject Apply(string nonce)
    {
        var expired = new JsonObject { ["outcome"] = "expired" };
        if (!NonceRe.IsMatch(nonce) || !issued.Remove(nonce, out string? hash)) return expired;
        string path = Path.Combine(CommandHome.Folder("pending"), $"{nonce}.json");
        JsonObject? pending = null;
        try { pending = JsonNode.Parse(File.ReadAllText(path)) as JsonObject; } catch (Exception e) when (e is IOException or System.Text.Json.JsonException) { }
        try { File.Delete(path); } catch (IOException) { }
        if (pending?["cmd"] is not JsonObject stored || Json.Num(pending["expires"], 0) < Now) return expired;
        if (CommandCheck.Canonical(stored, out _)?.Command is not JsonObject kept || CommandCheck.Fingerprint(kept) != hash || Text(pending["hash"]) != hash) return expired;

        var (verdict, cmd) = CommandCheck.Command(kept, Flag(pending["tainted"], true));
        if (cmd == null) return new JsonObject { ["outcome"] = "refused", ["verdict"] = verdict };
        var was = pending["verdict"] as JsonObject;
        int tier = CommandCheck.Tier(verdict);
        bool admin = CommandCheck.Admin(verdict);
        if (was == null || !CommandCheck.Allowed(was) || CommandCheck.Tier(was) != tier || CommandCheck.Admin(was) != admin)
            return Refused("Rig's check of this command changed since you saw it, so nothing ran. Ask Rig for the change again.", verdict);
        if (admin && !Native.IsAdmin())
            return Refused("This needs admin rights, and Rig's helper is running without them. Restart Rig and choose Yes when Windows asks, then ask for the change again.", verdict);
        if (admin && !Flag(pending["approved"], false))
            return Refused("This needs admin rights, and it wasn't approved at Windows' own prompt, so nothing ran.", verdict);
        if (tier >= 2 && !UnderCap())
            return Refused($"Rig makes at most {DailyCap} bigger changes a day on this PC, and today's are used up. Nothing ran.", verdict);

        var ctx = Context(admin);
        var touches = cmd["touches"]!.AsArray().Select(t => t!.AsObject()).ToList();
        string id = $"{(Native.IsAdmin() ? "a" : "u")}-{RandomNumberGenerator.GetHexString(24, lowercase: true)}";
        string dir = Path.Combine(CommandHome.Folder("undo"), id);
        Directory.CreateDirectory(dir);
        bool keep = false;
        try
        {
            var before = touches.Select((t, i) => Snapshot.Read(t, ctx, dir, $"t{i}")).ToList();
            // A key or file too big to snapshot was counted as snapshotted when the tier was worked out, so without an undo script it doesn't run.
            if (cmd["undo"] == null && before.Where(b => b["kind"]!.GetValue<string>() != "none").Select(Snapshot.Partial).FirstOrDefault(x => x != null) is string partial)
                return Refused($"{partial}, and there is no undo script, so Rig couldn't put this back. Nothing ran.", verdict);

            var (point, pointNote) = tier >= 2 && restorePoints ? RestorePoints.Ensure(CommandHome.Root) : (null, null);
            var guard = Sentinels.Read(person);
            string printedBefore = Look(cmd);

            PinnedShell.Ran? ran = null;
            string? error = null;
            try { ran = Run(Text(cmd["run"])!, admin, RunTimeoutMs); }
            catch (Exception e) when (e is RigException or System.ComponentModel.Win32Exception) { error = e is RigException ? e.Message : $"Rig couldn't start the change script ({e.Message})."; }
            if (ran is { TimedOut: true }) error = "The change script was still running after 10 minutes, so Rig stopped it.";
            else if (ran is { Ok: false }) error = $"The change script failed (exit code {ran.Exit}).";

            List<string> PutBack()
            {
                var notBack = new List<string>();
                for (int i = 0; i < touches.Count; i++)
                    if (Snapshot.Partial(before[i]) == null) notBack.AddRange(Snapshot.Restore(touches[i], before[i], ctx, name => File.ReadAllBytes(Path.Combine(dir, name))));
                    else if (Snapshot.Hash(Snapshot.Read(touches[i], ctx)) != Snapshot.Hash(before[i])) notBack.Add(Snapshot.Partial(before[i])!);
                return notBack;
            }
            JsonObject Result(List<JsonObject> now) => new()
            {
                ["before"] = printedBefore, ["after"] = Look(cmd),
                ["touches"] = new JsonArray(touches.Select((t, i) => (JsonNode)new JsonObject { ["touch"] = t.DeepClone(), ["before"] = Snapshot.Show(before[i]), ["after"] = Snapshot.Show(now[i]) }).ToArray()),
                ["output"] = Clip(ran?.Text ?? ""), ["alsoChanged"] = new JsonArray(),
            };

            List<Sentinels.Hit> hits;
            List<JsonObject> now;
            try
            {
                var after = Sentinels.Read(person);
                hits = guard.Compare(after, cmd["touches"]!.AsArray());
                if (hits.Count > 0 || error != null)
                {
                    var notBack = PutBack();
                    if (hits.Count > 0) notBack.AddRange(guard.Restore(after, hits, person));
                    var rolled = new JsonObject
                    {
                        ["outcome"] = "rolledBack", ["result"] = Result(touches.Select(t => Snapshot.Read(t, ctx)).ToList()),
                        ["sentinels"] = new JsonArray(hits.Select(h => (JsonNode)h.ToJson()).ToArray()),
                    };
                    if (notBack.Count > 0) error = $"{error ?? "The change wrote somewhere Rig never changes."} Rig couldn't put everything back: {string.Join("; ", notBack)}.";
                    if (error != null) rolled["error"] = error;
                    return rolled;
                }
                now = touches.Select(t => Snapshot.Read(t, ctx)).ToList();
            }
            catch (Exception e) when (e is not OutOfMemoryException)
            {
                // The change ran but Rig couldn't finish checking it. Without that check there is no honest undo record, so it goes back now.
                List<string> notBack;
                try { notBack = PutBack(); } catch (Exception again) when (again is not OutOfMemoryException) { notBack = [$"the restore itself failed ({again.Message.TrimEnd('.')})"]; }
                throw new RigException($"Rig ran the change but couldn't check what it did ({e.Message.TrimEnd('.')}), so it put back what the change said it touches{(notBack.Count > 0 ? $", except: {string.Join("; ", notBack)}" : "")}.");
            }
            var result = Result(now);

            var post = now.Select(Snapshot.Hash).ToList();
            string fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", post)))).ToLowerInvariant();
            var record = new JsonObject
            {
                ["id"] = id, ["at"] = Now, ["person"] = person.Sid, ["admin"] = admin, ["cmd"] = cmd.DeepClone(),
                ["before"] = new JsonArray(before.Select(b => (JsonNode)b).ToArray()), ["post"] = Strings(post), ["fingerprint"] = fingerprint,
            };
            if (point != null) record["restorePoint"] = point.DeepClone();
            if (pointNote != null) record["restorePointNote"] = pointNote;
            File.WriteAllText(Path.Combine(dir, "record.json"), record.ToJsonString());
            keep = true;

            var undo = new JsonObject { ["kind"] = "command", ["id"] = id };
            if (cmd["undo"] != null) undo["script"] = Text(cmd["undo"]);
            if (point != null) undo["restorePoint"] = point;
            undo["outside"] = new JsonArray();
            undo["fingerprint"] = fingerprint;
            return new JsonObject { ["outcome"] = "applied", ["result"] = result, ["undo"] = undo };
        }
        finally
        {
            if (!keep) try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    /// Counts one bigger change against today's limit. False when the limit is already reached.
    bool UnderCap()
    {
        string file = Path.Combine(Path.GetDirectoryName(CommandHome.Folder("pending"))!, "cap.json"), today = DateTime.Now.ToString("yyyy-MM-dd");
        JsonObject? cap = null;
        try { cap = JsonNode.Parse(File.ReadAllText(file)) as JsonObject; } catch (Exception e) when (e is IOException or System.Text.Json.JsonException) { }
        int count = Text(cap?["day"]) == today ? (int)Json.Num(cap?["count"], 0) : 0;
        if (count >= DailyCap) return false;
        File.WriteAllText(file, new JsonObject { ["day"] = today, ["count"] = count + 1 }.ToJsonString());
        return true;
    }

    JsonObject Undo(string id)
    {
        var unknown = new JsonObject { ["outcome"] = "unknown" };
        if (!IdRe.IsMatch(id)) return unknown;
        bool elevatedRecord = id[0] == 'a';
        if (elevatedRecord && !Native.IsAdmin())
            return new JsonObject { ["outcome"] = "failed", ["error"] = "This change was made with admin rights, and Rig's helper is running without them. Restart Rig, choose Yes when Windows asks, and undo it again." };

        // A record made without admin rights sits in the person's own profile, where they could have changed it. With admin rights the helper
        // opens it, and puts back everything in it, as the person: it can do nothing through that record the person couldn't do themselves.
        bool asPerson = !elevatedRecord && Native.IsAdmin();
        T Stored<T>(Func<T> read) { if (!asPerson) return read(); T got = default!; person.As(() => got = read()); return got; }
        string? home = elevatedRecord || !asPerson ? CommandHome.Root : person.Profile() is string local ? Path.Combine(local, "Rig", "Commands") : null;
        if (home == null) return unknown;
        string dir = Path.Combine(home, "undo", id);
        JsonObject? record = Stored(() =>
        {
            try { return JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "record.json"))) as JsonObject; }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { return null; }
        });
        if (record?["cmd"] is not JsonObject kept || CommandCheck.Canonical(kept, out _)?.Command is not JsonObject cmd || record["before"] is not JsonArray beforeList || record["post"] is not JsonArray postList) return unknown;
        if (Text(record["person"]) != person.Sid) return new JsonObject { ["outcome"] = "failed", ["error"] = "This change was made for a different Windows account, so Rig won't undo it from this one." };

        bool admin = elevatedRecord && Flag(record["admin"], false);
        var ctx = Context(admin);
        var touches = cmd["touches"]!.AsArray().Select(t => t!.AsObject()).ToList();
        if (touches.Count != beforeList.Count || touches.Count != postList.Count) return unknown;
        var point = record["restorePoint"]?.DeepClone() as JsonObject;
        var left = new List<string>();
        var failed = new List<string>();
        if (touches.Count == 0 && cmd["undo"] == null) failed.Add("this change came with no undo script and nothing Rig could snapshot");
        JsonObject Failed(string error)
        {
            string last = point != null ? $" Windows' restore point \"{Text(point["name"])}\" from before the change is the last resort."
                : Text(record["restorePointNote"]) is string note ? $" There is no restore point to fall back on: {note}." : "";
            var reply = new JsonObject { ["outcome"] = "failed", ["error"] = error + last };
            if (point != null) reply["restorePoint"] = point;
            return reply;
        }

        try
        {
            var drifted = new bool[touches.Count];
            for (int i = 0; i < touches.Count; i++)
            {
                var was = beforeList[i]!.AsObject();
                string now = Snapshot.Hash(Snapshot.Read(touches[i], ctx));
                if (now == Snapshot.Hash(was)) continue;
                if (now != Text(postList[i]))
                {
                    drifted[i] = true;
                    left.Add($"{Snapshot.Name(touches[i])} changed again after Rig's change, so Rig left it as it is now");
                }
                else if (Snapshot.Partial(was) == null)
                    failed.AddRange(Snapshot.Restore(touches[i], was, ctx, name => Stored(() => File.ReadAllBytes(Path.Combine(dir, name)))));
            }

            if (Text(cmd["undo"]) is string script)
            {
                var verdict = CommandCheck.Script(script, "undo");
                if (!CommandCheck.Allowed(verdict)) failed.Add($"Rig no longer runs the undo script: {Text(verdict["refused"])}");
                else if (CommandCheck.Admin(verdict) && !admin) failed.Add("the undo script needs admin rights that this change never had, so Rig didn't run it");
                else
                {
                    var guard = Sentinels.Read(person);
                    PinnedShell.Ran? ran = null;
                    try { ran = Run(script, admin, RunTimeoutMs); }
                    catch (Exception e) when (e is RigException or System.ComponentModel.Win32Exception) { failed.Add($"the undo script didn't start ({e.Message.TrimEnd('.')})"); }
                    if (ran is { Ok: false }) failed.Add(ran.TimedOut ? "the undo script was still running after 10 minutes, so Rig stopped it" : $"the undo script failed (exit code {ran.Exit}): {Clip(ran.Text)}");
                    var after = Sentinels.Read(person);
                    var hits = guard.Compare(after, cmd["touches"]!.AsArray());
                    if (hits.Count > 0)
                    {
                        left.Add($"the undo script wrote somewhere Rig never changes ({string.Join(", ", hits.Select(h => h.Sentinel))}), and Rig put that back");
                        failed.AddRange(guard.Restore(after, hits, person));
                    }
                }
            }

            for (int i = 0; i < touches.Count; i++)
            {
                var was = beforeList[i]!.AsObject();
                if (drifted[i]) continue;
                if (Snapshot.Partial(was) is string partial && cmd["undo"] == null) failed.Add(partial);
                else if (was["kind"]!.GetValue<string>() != "none" && Snapshot.Hash(Snapshot.Read(touches[i], ctx)) != Snapshot.Hash(was) && !failed.Any(f => f.StartsWith(Snapshot.Name(touches[i]), StringComparison.Ordinal)))
                    failed.Add($"{Snapshot.Name(touches[i])} isn't back to how it was");
            }
        }
        catch (Exception e) when (e is RigException or IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            failed.Add(e.Message.TrimEnd('.'));
        }

        if (failed.Count > 0) return Failed($"Rig couldn't put everything back: {string.Join("; ", failed.Concat(left))}.");
        Stored(() => { try { Directory.Delete(dir, recursive: true); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { } return true; });
        return new JsonObject { ["outcome"] = "undone", ["printed"] = Look(cmd), ["left"] = Strings(left) };
    }
}

/// Windows' own restore points, as the last resort behind Rig's snapshot: best-effort, at most one a day, and never waited on for long.
public static class RestorePoints
{
    const string Scope = @"\\.\root\default";

    /// Why Windows keeps no restore points here, or null when it does.
    public static string? Off()
    {
        try
        {
            return Reg.ReadValue(Reg.Machine, @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore", "RPSessionInterval") is { Data.Length: 4 } on && BitConverter.ToInt32(on.Data) != 0
                ? null : "System Protection is off on this PC, so there is no Windows restore point to fall back on";
        }
        catch (RigException) { return "Rig couldn't tell whether System Protection is on"; }
    }

    /// Today's restore point, making one if there isn't one yet. Null with a note when there is none to name.
    public static (JsonObject? Point, string? Note) Ensure(string home)
    {
        if (!Native.IsAdmin()) return (null, "Rig's helper ran without admin rights, which making a restore point needs");
        if (Off() is string off) return (null, off);
        string file = Path.Combine(home, "restorepoint.json");
        try
        {
            if (JsonNode.Parse(File.ReadAllText(file)) is JsonObject last && DateTimeOffset.TryParse(last["at"]?.GetValue<string>(), out var at) && at > DateTimeOffset.UtcNow.AddDays(-1) && Exists((uint)Json.Num(last["seq"], 0)))
                return (last, null);
        }
        catch (Exception e) when (e is IOException or System.Text.Json.JsonException or ManagementException or System.Runtime.InteropServices.COMException) { }

        string name = $"Rig, before a change on {DateTime.Now:yyyy-MM-dd}";
        var making = Task.Run(() => Create(name));
        try
        {
            if (!making.Wait(TimeSpan.FromSeconds(30))) return (null, "Windows was still making the restore point when the change ran");
            if (making.Result is not JsonObject point) return (null, "Windows didn't make a restore point");
            File.WriteAllText(file, point.ToJsonString());
            return (point, null);
        }
        catch (AggregateException e) { return (null, $"Windows didn't make a restore point ({e.InnerException?.Message.TrimEnd('.')})"); }
    }

    static bool Exists(uint seq)
    {
        using var search = new ManagementObjectSearcher(Scope, $"SELECT SequenceNumber FROM SystemRestore WHERE SequenceNumber = {seq}");
        using var found = search.Get();
        return found.Count > 0;
    }

    /// Asks Windows for a restore point and names the newest one there is: Windows skips making one when it made another in the last day.
    static JsonObject? Create(string name)
    {
        using (var restore = new ManagementClass(Scope, "SystemRestore", null))
        using (var args = restore.GetMethodParameters("CreateRestorePoint"))
        {
            args["Description"] = name;
            args["RestorePointType"] = 12u;
            args["EventType"] = 100u;
            using var answer = restore.InvokeMethod("CreateRestorePoint", args, null);
            if (Convert.ToUInt32(answer["ReturnValue"]) != 0) return null;
        }
        using var search = new ManagementObjectSearcher(Scope, "SELECT SequenceNumber, Description, CreationTime FROM SystemRestore");
        using var all = search.Get();
        JsonObject? newest = null;
        foreach (ManagementBaseObject p in all)
            using (p)
            {
                uint seq = Convert.ToUInt32(p["SequenceNumber"]);
                if (newest != null && seq < Json.Num(newest["seq"], 0)) continue;
                newest = new JsonObject { ["seq"] = seq, ["name"] = p["Description"]?.ToString() ?? "", ["at"] = new DateTimeOffset(ManagementDateTimeConverter.ToDateTime(p["CreationTime"].ToString()!)).ToUniversalTime().ToString("o") };
            }
        return newest;
    }
}
