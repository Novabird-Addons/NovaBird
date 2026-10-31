// Namen der Grafikkarten in der Reihenfolge, in der DirectML sie zählt (DXGI-Adapter 0, 1, …; ohne Software-Adapter).
using System.Runtime.InteropServices;

namespace NovaBird.Helper;

static class Dxgi
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct AdapterDesc1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision;
        public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow; public int LuidHigh;
        public uint Flags;
    }

    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIFactory1
    {
        // IDXGIObject
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        // IDXGIFactory
        void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
        // IDXGIFactory1
        [PreserveSig] int EnumAdapters1(uint index, out IDXGIAdapter1 adapter);
        [PreserveSig] bool IsCurrent();
    }

    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIAdapter1
    {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();
        [PreserveSig] int GetDesc1(out AdapterDesc1 desc);
    }

    [DllImport("dxgi.dll")]
    static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDXGIFactory1 factory);

    const uint SoftwareAdapter = 2;

    /// <summary>Gibt es eine NVIDIA-Karte (dann braucht Ollama seine CUDA-Bibliotheken)?</summary>
    public static bool HasNvidia()
    {
        try
        {
            var iid = typeof(IDXGIFactory1).GUID;
            if (CreateDXGIFactory1(ref iid, out var factory) != 0) return false;
            bool found = false;
            for (uint i = 0; factory.EnumAdapters1(i, out var a) == 0; i++)
            {
                if (a.GetDesc1(out var d) == 0 && (d.Flags & SoftwareAdapter) == 0 && d.VendorId == 0x10DE) found = true;
                Marshal.ReleaseComObject(a);
            }
            Marshal.ReleaseComObject(factory);
            return found;
        }
        catch { return true; } // im Zweifel alles entpacken
    }

    /// <summary>Kennung der Grafikkarte, wie sie in den Leistungsindikatoren steht („luid_0x00000000_0x0000D1A5“).</summary>
    public static string Luid(int index)
    {
        try
        {
            var iid = typeof(IDXGIFactory1).GUID;
            if (CreateDXGIFactory1(ref iid, out var factory) != 0) return null;
            string luid = null;
            if (factory.EnumAdapters1((uint)index, out var a) == 0)
            {
                if (a.GetDesc1(out var d) == 0) luid = $"luid_0x{d.LuidHigh:X8}_0x{d.LuidLow:X8}";
                Marshal.ReleaseComObject(a);
            }
            Marshal.ReleaseComObject(factory);
            return luid;
        }
        catch { return null; }
    }

    /// <summary>(DirectML-Index, Name, Grafikspeicher in MB) je Hardware-Adapter.</summary>
    public static List<(int Index, string Name, long VramMB)> Adapters()
    {
        var list = new List<(int, string, long)>();
        try
        {
            var iid = typeof(IDXGIFactory1).GUID;
            if (CreateDXGIFactory1(ref iid, out var factory) != 0) return list;
            for (uint i = 0; factory.EnumAdapters1(i, out var a) == 0; i++)
            {
                if (a.GetDesc1(out var d) == 0 && (d.Flags & SoftwareAdapter) == 0)
                    list.Add(((int)i, d.Description.Trim(), (long)(d.DedicatedVideoMemory.ToUInt64() >> 20)));
                Marshal.ReleaseComObject(a);
            }
            Marshal.ReleaseComObject(factory);
        }
        catch (Exception e) { Log.Write("DXGI: " + e.Message); }
        return list;
    }
}
