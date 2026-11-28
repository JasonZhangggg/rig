// Whether the PC is a laptop, from what Windows says about its case, its power
// profile and its batteries. A UPS on a USB cable shows up as a battery too, so
// a battery alone only counts when nothing else says, and only one that isn't a UPS.
// No Windows calls here, so the self-test can check the rules with made-up readings.

using System.Text.RegularExpressions;

namespace Rig.Helper;

public static class PcKind
{
    /// Win32_SystemEnclosure.ChassisTypes (the SMBIOS chassis types) for portable PCs: portable, laptop, notebook,
    /// hand held, sub notebook, tablet, convertible, detachable.
    static readonly HashSet<long> Portable = [8, 9, 10, 11, 14, 30, 31, 32];
    /// The desktop ones: desktop, low profile, pizza box, mini tower, tower, all in one, space-saving, lunch box,
    /// main system chassis, sealed-case PC, mini PC, stick PC.
    static readonly HashSet<long> Desktop = [3, 4, 5, 6, 7, 13, 15, 16, 17, 24, 35, 36];

    /// A row of Win32_Battery: its name and Chemistry (3 lead acid, 6 lithium-ion, 8 lithium polymer, 2 unknown).
    public record Battery(string Name, long Chemistry);

    /// A battery inside the PC, not a UPS: UPSes run on lead-acid cells and say what they are in their name.
    public static bool Internal(Battery b) =>
        b.Chemistry != 3 && !Regex.IsMatch(b.Name, @"\bUPS\b|uninterruptible", RegexOptions.IgnoreCase);

    /// pcSystemType is Win32_ComputerSystem.PCSystemType (1 desktop, 2 mobile, 3 workstation, 8 slate; 0 unknown).
    public static bool Laptop(long pcSystemType, IReadOnlyCollection<long> chassis, IReadOnlyCollection<Battery> batteries)
    {
        if (pcSystemType is 2 or 8) return true;
        if (chassis.Any(Portable.Contains)) return true;
        if (chassis.Any(Desktop.Contains)) return false;
        if (pcSystemType is >= 1 and <= 7) return false;
        // Nothing else says (a home-built PC's board often reports "Other"), so an internal battery settles it.
        return batteries.Any(Internal);
    }

    /// The rules against readings Rig has seen on real PCs, for --selftest.
    public static IEnumerable<string> SelfChecks()
    {
        var ups = new Battery("Back-UPS ES 700G FW:871.O4 .I USB FW:O4", 3);
        var cases = new (string what, long pcType, long[] chassis, Battery[] batteries, bool laptop)[]
        {
            ("a desktop with a USB UPS", 1, [3], [ups], false),
            ("a tower with a UPS that says no chemistry", 1, [7], [new("CyberPower UPS", 2)], false),
            ("a home-built PC with a UPS and nothing else said", 0, [2], [ups], false),
            ("a home-built PC with no battery", 0, [1], [], false),
            ("a laptop by its power profile", 2, [10], [new("Internal Battery", 2)], true),
            ("a laptop by its case alone", 1, [9], [], true),
            ("a convertible", 0, [31], [new("DELL 7FHHV", 6)], true),
            ("a laptop that says nothing but its battery", 0, [2], [new("Primary", 6)], true),
            ("a laptop plugged into a UPS", 2, [10], [new("Primary", 2), ups], true),
        };
        foreach (var c in cases)
            if (Laptop(c.pcType, c.chassis, c.batteries) != c.laptop)
                yield return $"{c.what} reads as a {(c.laptop ? "tower" : "laptop")}";
    }
}
