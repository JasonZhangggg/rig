// The connection check behind "Is it my PC or my internet?". Started by the person in the Rig app, it reads the
// adapter that carries the PC's traffic (Wi-Fi or a cable, its link speed and driver), the Wi-Fi signal, band and
// radio, whether a VPN is connected, and pings the router and the internet five times each, and times a website
// lookup that skips Windows' cache. It only reads: nothing on the PC or the router changes.
//
// The pings take a few seconds, and the helper answers one request at a time, so the check runs on its own thread:
// `network` with start begins one and answers at once, and later calls say whether it's done (NetworkCheck.Read),
// so the readings keep coming meanwhile. Every part is guarded: a part that fails is left out, and the check never throws.

using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Rig.Helper;

/// Five pings to one place. AvgMs is the average of the ones that came back, or null when none did.
public record PingResult(string Target, int Sent, int Received, double? AvgMs);
/// Kind is "wifi", "ethernet" or "other". DriverDate is YYYY-MM-DD.
public record NetAdapter(string Kind, string Name, string? Description, double? LinkMbps, string? DriverDate, string? DriverVersion);
/// Signal is Windows' signal quality, 0 to 100. Band is "2.4 GHz", "5 GHz" or "6 GHz"; Radio is like "802.11ax".
public record WifiLink(int Signal, string? Band, int? Channel, string? Radio);
/// Ms is null when the lookup failed or took longer than the check waits.
public record DnsTime(string Name, double? Ms);
public record VpnOn(string Name);
/// The shape packages/core/src/network.ts reads as NetworkReading (nulls are left out of the JSON).
public record NetworkReading(long At, NetAdapter? Adapter, WifiLink? Wifi, PingResult? Gateway, PingResult Internet, DnsTime Dns, VpnOn? Vpn);

public static class NetworkCheck
{
    /// A well-known address that answers pings, and a well-known name to look up.
    static readonly IPAddress InternetTarget = IPAddress.Parse("1.1.1.1");
    const string LookupName = "www.microsoft.com";
    const int Pings = 5;
    const int PingTimeoutMs = 1000;
    const int PingGapMs = 200;
    /// The whole check gives up waiting after this, and reports what it has.
    static readonly TimeSpan Budget = TimeSpan.FromSeconds(8);
    static readonly TimeSpan LookupBudget = TimeSpan.FromSeconds(4);

    static readonly object gate = new();
    static bool running;
    static NetworkReading? last;

    /// Starts a check when asked and none is running, then says whether one is running and gives the last one finished.
    public static JsonObject Read(bool start)
    {
        lock (gate)
        {
            if (start && !running)
            {
                running = true;
                last = null;
                new Thread(Run) { IsBackground = true, Name = "Rig network check" }.Start();
            }
            var o = new JsonObject { ["running"] = running };
            if (last != null) o["reading"] = Json.From(last);
            return o;
        }
    }

    static void Run()
    {
        NetworkReading? reading = null;
        try { reading = Measure(); } catch { /* the app says the check couldn't run */ }
        lock (gate) { last = reading; running = false; }
    }

    /// The check itself, start to finish: within about eight seconds, whatever answers.
    public static NetworkReading Measure()
    {
        long at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        NetworkInterface? ni = null;
        IPAddress? gateway = null;
        try { (ni, gateway) = ActiveAdapter(); } catch { }
        // The pings and the lookup run side by side while the adapter is read.
        var internetPings = PingAsync(InternetTarget);
        var gatewayPings = gateway != null ? PingAsync(gateway) : null;
        var lookup = Task.Run(Lookup);
        NetAdapter? adapter = null;
        WifiLink? wifi = null;
        VpnOn? vpn = null;
        try { if (ni != null) adapter = Describe(ni); } catch { }
        try { if (ni?.NetworkInterfaceType == NetworkInterfaceType.Wireless80211) wifi = Wifi(ni.Id); } catch { }
        try { vpn = Vpn(); } catch { }
        var all = new List<Task> { internetPings, lookup };
        if (gatewayPings != null) all.Add(gatewayPings);
        try { Task.WhenAll(all).Wait(Budget); } catch { }
        PingResult Done(Task<PingResult> t, IPAddress target) => t.IsCompletedSuccessfully ? t.Result : new PingResult(target.ToString(), Pings, 0, null);
        return new NetworkReading(
            at, adapter, wifi,
            gatewayPings != null ? Done(gatewayPings, gateway!) : null,
            Done(internetPings, InternetTarget),
            new DnsTime(LookupName, lookup.IsCompletedSuccessfully ? lookup.Result : null),
            vpn);
    }

    static async Task<PingResult> PingAsync(IPAddress target)
    {
        int received = 0;
        double total = 0;
        using var ping = new Ping();
        for (int i = 0; i < Pings; i++)
        {
            if (i > 0) await Task.Delay(PingGapMs);
            try
            {
                var reply = await ping.SendPingAsync(target, PingTimeoutMs);
                if (reply.Status == IPStatus.Success) { received++; total += reply.RoundtripTime; }
            }
            catch (PingException) { }
            catch (InvalidOperationException) { }
        }
        return new PingResult(target.ToString(), Pings, received, received > 0 ? Math.Round(total / received, 1) : null);
    }

    // ---- The adapter ----

    static readonly string[] VpnWords =
    [
        "vpn", "wireguard", "wintun", "tap-windows", "openvpn", "nordlynx", "anyconnect", "forticlient", "fortinet ssl",
        "globalprotect", "pangp", "zscaler", "tailscale", "zerotier", "protonvpn", "expressvpn", "mullvad", "surfshark", "windscribe",
    ];

    static bool LooksLikeVpn(NetworkInterface ni)
    {
        if (ni.NetworkInterfaceType == NetworkInterfaceType.Ppp) return true;
        string words = $"{ni.Name} {ni.Description}".ToLowerInvariant();
        return VpnWords.Any(words.Contains);
    }

    static bool HasIPv4(NetworkInterface ni) =>
        ni.GetIPProperties().UnicastAddresses.Any(a => a.Address.AddressFamily == AddressFamily.InterNetwork && !a.Address.ToString().StartsWith("169.254.", StringComparison.Ordinal));

    [DllImport("iphlpapi.dll")] static extern int GetBestInterface(uint destAddr, out uint bestIfIndex);

    /// The adapter with a way out to the internet, and its router. With a VPN on, the adapter under it: the one Windows
    /// would use if the VPN weren't there.
    static (NetworkInterface?, IPAddress?) ActiveAdapter()
    {
        var found = new List<(NetworkInterface ni, IPAddress gw, int index)>();
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            if (LooksLikeVpn(ni)) continue;
            try
            {
                var props = ni.GetIPProperties();
                var gw = props.GatewayAddresses.Select(g => g.Address)
                    .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !a.Equals(IPAddress.Any));
                if (gw == null) continue;
                int index = props.GetIPv4Properties()?.Index ?? -1;
                found.Add((ni, gw, index));
            }
            catch (NetworkInformationException) { }
        }
        if (found.Count == 0) return (null, null);
        uint best = 0;
        try
        {
            // GetBestInterface takes the address in network byte order, as the bytes of the address read as an integer.
            if (GetBestInterface(BitConverter.ToUInt32(InternetTarget.GetAddressBytes(), 0), out uint b) == 0) best = b;
        }
        catch { }
        var pick = found.FirstOrDefault(f => best != 0 && f.index == (int)best);
        if (pick.ni == null) pick = found.FirstOrDefault(f => Kind(f.ni) == "ethernet");
        if (pick.ni == null) pick = found.FirstOrDefault(f => Kind(f.ni) == "wifi");
        if (pick.ni == null) pick = found[0];
        return (pick.ni, pick.gw);
    }

    static string Kind(NetworkInterface ni) => ni.NetworkInterfaceType switch
    {
        NetworkInterfaceType.Wireless80211 => "wifi",
        NetworkInterfaceType.Ethernet or NetworkInterfaceType.GigabitEthernet or NetworkInterfaceType.FastEthernetT
            or NetworkInterfaceType.FastEthernetFx or NetworkInterfaceType.Ethernet3Megabit => "ethernet",
        _ => "other",
    };

    static NetAdapter Describe(NetworkInterface ni)
    {
        double? mbps = null;
        // Some drivers report a made-up speed (the largest number there is) while the link settles.
        try { if (ni.Speed > 0 && ni.Speed <= 400_000_000_000L) mbps = Math.Round(ni.Speed / 1e6, 1); } catch { }
        var (date, version) = Driver(ni.Id);
        return new NetAdapter(Kind(ni), ni.Name, ni.Description, mbps, date, version);
    }

    const string NetClass = @"SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}";

    /// The driver's date and version, from the adapter's key under the network class: cheaper than asking WMI.
    static (string?, string?) Driver(string id)
    {
        try
        {
            using var cls = Registry.LocalMachine.OpenSubKey(NetClass);
            if (cls == null) return (null, null);
            foreach (var sub in cls.GetSubKeyNames())
            {
                try
                {
                    using var k = cls.OpenSubKey(sub);
                    if (k?.GetValue("NetCfgInstanceId") is not string cfg || !string.Equals(cfg, id, StringComparison.OrdinalIgnoreCase)) continue;
                    return (DriverDate(k.GetValue("DriverDate") as string), k.GetValue("DriverVersion") as string);
                }
                catch (System.Security.SecurityException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        catch { }
        return (null, null);
    }

    /// Windows writes a driver's date as month-day-year, like "8-14-2023".
    public static string? DriverDate(string? raw)
    {
        var m = raw == null ? null : Regex.Match(raw.Trim(), @"^(\d{1,2})-(\d{1,2})-(\d{4})$");
        if (m == null || !m.Success) return null;
        int month = int.Parse(m.Groups[1].Value), day = int.Parse(m.Groups[2].Value), year = int.Parse(m.Groups[3].Value);
        if (month is < 1 or > 12 || day is < 1 or > 31) return null;
        return $"{year:D4}-{month:D2}-{day:D2}";
    }

    static VpnOn? Vpn()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up || !LooksLikeVpn(ni)) continue;
            try { if (!HasIPv4(ni)) continue; } catch { continue; }
            // The connection's own name when it says what it is, otherwise the adapter's.
            string name = VpnWords.Any(ni.Name.ToLowerInvariant().Contains) || string.IsNullOrWhiteSpace(ni.Description) ? ni.Name : ni.Description;
            return new VpnOn(name);
        }
        return null;
    }

    // ---- The lookup ----

    [DllImport("dnsapi.dll", EntryPoint = "DnsQuery_W", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int DnsQuery(string name, ushort type, uint options, IntPtr extra, out IntPtr results, IntPtr reserved);
    [DllImport("dnsapi.dll")] static extern void DnsRecordListFree(IntPtr list, int freeType);
    const ushort DnsTypeA = 1;
    const uint DnsQueryBypassCache = 0x8, DnsQueryNoHostsFile = 0x40;
    const int DnsFreeRecordList = 1;

    /// How long a lookup of a well-known name takes from the DNS server, skipping Windows' cache and the hosts file.
    static async Task<double?> Lookup()
    {
        var timed = Task.Run(() =>
        {
            var sw = Stopwatch.StartNew();
            int status = DnsQuery(LookupName, DnsTypeA, DnsQueryBypassCache | DnsQueryNoHostsFile, IntPtr.Zero, out IntPtr results, IntPtr.Zero);
            double took = sw.Elapsed.TotalMilliseconds;
            if (results != IntPtr.Zero) DnsRecordListFree(results, DnsFreeRecordList);
            return status == 0 ? Math.Round(took, 1) : (double?)null;
        });
        var first = await Task.WhenAny(timed, Task.Delay(LookupBudget));
        return first == timed && timed.IsCompletedSuccessfully ? timed.Result : null;
    }

    // ---- Wi-Fi ----

    [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiatedVersion, out IntPtr handle);
    [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr handle, IntPtr reserved);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memory);
    [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr handle, ref Guid iface, int opCode, IntPtr reserved, out int dataSize, out IntPtr data, IntPtr opcodeValueType);
    const int OpCurrentConnection = 7, OpChannelNumber = 8;
    const int StateConnected = 1;

    [StructLayout(LayoutKind.Sequential)]
    struct Dot11Ssid { public uint Length; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Ssid; }

    [StructLayout(LayoutKind.Sequential)]
    struct WlanAssociationAttributes
    {
        public Dot11Ssid Ssid;
        public int BssType;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] Bssid;
        public int PhyType;
        public uint PhyIndex;
        public uint SignalQuality;
        public uint RxRate;
        public uint TxRate;
    }

    /// The start of WLAN_CONNECTION_ATTRIBUTES; the security attributes after it aren't read.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WlanConnectionAttributes
    {
        public int State;
        public int Mode;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string ProfileName;
        public WlanAssociationAttributes Association;
    }

    /// DOT11_PHY_TYPE, as the standard's name.
    static string? Radio(int phy) => phy switch
    {
        4 => "802.11a", 5 => "802.11b", 6 => "802.11g", 7 => "802.11n", 8 => "802.11ac", 10 => "802.11ax", 11 => "802.11be", _ => null,
    };

    static WifiLink? Wifi(string adapterId)
    {
        int? signal = null, channel = null, phy = null;
        if (Guid.TryParse(adapterId, out var guid))
        {
            IntPtr handle = IntPtr.Zero;
            try
            {
                if (WlanOpenHandle(2, IntPtr.Zero, out _, out handle) == 0)
                {
                    if (WlanQueryInterface(handle, ref guid, OpCurrentConnection, IntPtr.Zero, out _, out IntPtr data, IntPtr.Zero) == 0 && data != IntPtr.Zero)
                    {
                        try
                        {
                            var c = Marshal.PtrToStructure<WlanConnectionAttributes>(data);
                            if (c.State == StateConnected) { signal = (int)Math.Min(100, c.Association.SignalQuality); phy = c.Association.PhyType; }
                        }
                        finally { WlanFreeMemory(data); }
                    }
                    if (WlanQueryInterface(handle, ref guid, OpChannelNumber, IntPtr.Zero, out _, out IntPtr ch, IntPtr.Zero) == 0 && ch != IntPtr.Zero)
                    {
                        try { int n = Marshal.ReadInt32(ch); if (n > 0) channel = n; } finally { WlanFreeMemory(ch); }
                    }
                }
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            finally { if (handle != IntPtr.Zero) WlanCloseHandle(handle, IntPtr.Zero); }
        }
        // netsh names the band on Windows 11. Its labels are in Windows' language, so only the values are read: "5 GHz", "78%", "802.11ax".
        string text = Netsh();
        var band = WifiText.Band(text) ?? BandOf(channel, phy);
        signal ??= WifiText.Signal(text);
        if (signal == null) return null;
        return new WifiLink(signal.Value, band, channel, phy is int p ? Radio(p) : WifiText.Radio(text));
    }

    /// The band from the channel, where only one band has it: 6 GHz came with Wi-Fi 6E, so older radios are on 2.4 or 5 GHz.
    public static string? BandOf(int? channel, int? phy)
    {
        if (channel is not int c) return null;
        if (c > 177) return "6 GHz";
        bool before6e = phy is int p && p < 10;
        if (!before6e) return null;
        return c <= 14 ? "2.4 GHz" : "5 GHz";
    }

    static string Netsh()
    {
        try
        {
            var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "netsh.exe"), "wlan show interfaces")
            {
                RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc == null) return "";
            var output = proc.StandardOutput.ReadToEndAsync();
            if (!proc.WaitForExit(3000)) { try { proc.Kill(); } catch { } return ""; }
            return output.Wait(1000) ? output.Result : "";
        }
        catch { return ""; }
    }

    /// What the self-test holds the check to: it finishes in time, pings five times, and names what it looked up.
    public static IEnumerable<string> SelfChecks(JsonObject all)
    {
        var sw = Stopwatch.StartNew();
        NetworkReading r;
        try { r = Measure(); }
        catch (Exception e) { return [$"the connection check threw: {e.Message}"]; }
        all["network"] = Json.From(r);
        var problems = new List<string>();
        if (sw.Elapsed > TimeSpan.FromSeconds(10)) problems.Add($"the connection check took {sw.Elapsed.TotalSeconds:F1} seconds");
        if (r.Internet.Sent != Pings) problems.Add($"the connection check sent {r.Internet.Sent} pings to the internet");
        if (r.Dns.Name != LookupName) problems.Add("the connection check didn't name its lookup");
        if (r.Wifi is { Signal: < 0 or > 100 }) problems.Add($"the Wi-Fi signal read {r.Wifi.Signal}");
        if (WifiText.Band("    Band                   : 5 GHz\r\n") != "5 GHz" || WifiText.Band("    Bande : 2,4 GHz\r\n") != "2.4 GHz") problems.Add("netsh's band wasn't read");
        if (DriverDate("8-14-2023") != "2023-08-14") problems.Add("a driver date wasn't read");
        return problems;
    }
}

/// The values netsh prints for a Wi-Fi connection, whatever language its labels are in.
public static class WifiText
{
    public static string? Band(string text)
    {
        var m = Regex.Match(text, @":\s*(2[.,]4|5|6)\s*GHz\s*$", RegexOptions.Multiline);
        return m.Success ? (m.Groups[1].Value.StartsWith('2') ? "2.4 GHz" : $"{m.Groups[1].Value} GHz") : null;
    }

    public static int? Signal(string text)
    {
        var m = Regex.Match(text, @":\s*(\d{1,3})\s*%\s*$", RegexOptions.Multiline);
        return m.Success && int.TryParse(m.Groups[1].Value, out int n) && n <= 100 ? n : null;
    }

    public static string? Radio(string text)
    {
        var m = Regex.Match(text, @"802\.11(be|ax|ac|n|g|a|b)\b");
        return m.Success ? m.Value : null;
    }
}
