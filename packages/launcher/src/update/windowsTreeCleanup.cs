using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OkwWindowsTreeCleanup
{
    const uint Access = 0x101001;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Entry
    {
        public uint Size, Usage, Pid;
        public IntPtr Heap;
        public uint Module, Threads, Parent;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }
    sealed class Owned
    {
        public uint Pid;
        public IntPtr Handle;
        public long Created;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static List<Entry> Snapshot()
    {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var entries = new List<Entry>();
            var entry = new Entry { Size = (uint)Marshal.SizeOf(typeof(Entry)) };
            if (!Process32FirstW(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
            do { entries.Add(entry); } while (Process32NextW(snapshot, ref entry));
            if (Marshal.GetLastWin32Error() != 18) throw new Win32Exception(Marshal.GetLastWin32Error());
            return entries;
        }
        finally { CloseHandle(snapshot); }
    }

    static Owned Open(uint pid)
    {
        IntPtr handle = OpenProcess(Access, false, pid);
        if (handle == IntPtr.Zero)
        {
            int code = Marshal.GetLastWin32Error();
            if (code == 87) return null;
            throw new Win32Exception(code);
        }
        long created, exited, kernel, user;
        if (GetProcessTimes(handle, out created, out exited, out kernel, out user))
            return new Owned { Pid = pid, Handle = handle, Created = created };
        int error = Marshal.GetLastWin32Error();
        CloseHandle(handle);
        throw new Win32Exception(error);
    }

    static int Capture(Dictionary<uint, Owned> owned)
    {
        var entries = Snapshot();
        int added = 0;
        bool changed;
        do
        {
            changed = false;
            foreach (var entry in entries)
            {
                Owned parent;
                if (owned.ContainsKey(entry.Pid) || !owned.TryGetValue(entry.Parent, out parent)) continue;
                var child = Open(entry.Pid);
                if (child == null) continue;
                if (child.Created < parent.Created) { CloseHandle(child.Handle); continue; }
                owned.Add(child.Pid, child);
                if (owned.Count > 4096) throw new Exception("owned process tree limit exceeded; descendants unconfirmed");
                changed = true;
                added++;
            }
        } while (changed);
        return added;
    }

    static void Stop(IEnumerable<Owned> owned)
    {
        foreach (var process in owned)
        {
            uint state = WaitForSingleObject(process.Handle, 0);
            if (state == 0) continue;
            if (state != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!TerminateProcess(process.Handle, 1) && WaitForSingleObject(process.Handle, 0) != 0)
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        foreach (var process in owned)
            if (WaitForSingleObject(process.Handle, 500) != 0) throw new Exception("owned process did not exit");
    }

    public static void Stop(uint pid, long earliest, long latest)
    {
        var owned = new Dictionary<uint, Owned>();
        try
        {
            var root = Open(pid);
            if (root == null) throw new Exception("parent already exited; descendants unconfirmed");
            owned.Add(pid, root);
            if (root.Created < earliest || root.Created > latest || WaitForSingleObject(root.Handle, 0) == 0)
                throw new Exception("parent identity changed or exited; descendants unconfirmed");
            Capture(owned);
            Stop(owned.Values);
            for (int pass = 0; pass < 4; pass++)
            {
                if (Capture(owned) == 0) return;
                Stop(owned.Values);
            }
            throw new Exception("child tree kept changing; descendants unconfirmed");
        }
        finally { foreach (var process in owned.Values) CloseHandle(process.Handle); }
    }
}
