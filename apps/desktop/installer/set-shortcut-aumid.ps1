#requires -Version 5.0
<#
Sets the System.AppUserModel.ID property on a .lnk shortcut so Windows
groups taskbar pins by app identity instead of by the bun runtime's exe
path. Without this, pinning the running window from the taskbar
captures bin/fgl.exe (Bun) — and clicking the pin runs fgl.exe with no
args, which just prints Bun's CLI help instead of launching our app.

Usage:
  set-shortcut-aumid.ps1 -LnkPath "C:\path\to\shortcut.lnk" -Aumid "Foo.BarApp"
#>
param(
    [Parameter(Mandatory = $true)] [string] $LnkPath,
    [Parameter(Mandatory = $true)] [string] $Aumid
)

if (-not (Test-Path $LnkPath)) {
    Write-Error "shortcut not found: $LnkPath"
    exit 1
}

$src = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace FgltAumid {
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    public class CShellLink { }

    // We never call IShellLinkW members directly; we just need the QI
    // path to find IPersistFile and IPropertyStore on the same object.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellLinkW { void __reserved(); }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        [PreserveSig] int GetCount(out uint c);
        [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
        [PreserveSig] int GetValue(ref PROPERTYKEY k, IntPtr pv);
        [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT pv);
        [PreserveSig] int Commit();
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY {
        public Guid fmtid;
        public int pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT {
        public ushort vt;
        public ushort r1, r2, r3;
        public IntPtr pwsz;
        public IntPtr unused;
    }

    public static class Helper {
        // PKEY_AppUserModel_ID = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, pid 5
        static readonly Guid PKEY_FMT =
            new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        const ushort VT_LPWSTR = 31;
        const int STGM_READWRITE = 2;

        public static int Set(string lnk, string aumid) {
            var c = new CShellLink();
            try {
                var pf = (IPersistFile)c;
                pf.Load(lnk, STGM_READWRITE);
                var ps = (IPropertyStore)c;
                var pv = new PROPVARIANT {
                    vt = VT_LPWSTR,
                    pwsz = Marshal.StringToCoTaskMemUni(aumid)
                };
                var k = new PROPERTYKEY { fmtid = PKEY_FMT, pid = 5 };
                int hr = ps.SetValue(ref k, ref pv);
                if (hr == 0) ps.Commit();
                Marshal.FreeCoTaskMem(pv.pwsz);
                if (hr == 0) pf.Save(lnk, true);
                return hr;
            } finally {
                Marshal.FinalReleaseComObject(c);
            }
        }
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop
$hr = [FgltAumid.Helper]::Set($LnkPath, $Aumid)
if ($hr -ne 0) {
    Write-Error "IPropertyStore.SetValue returned HRESULT 0x$($hr.ToString('X8'))"
    exit 1
}
Write-Host "set AUMID '$Aumid' on $LnkPath"
