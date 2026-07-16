using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

public sealed class GodModeService : ServiceBase
{
    private Process child;

    public GodModeService()
    {
        ServiceName = "GodMode";
        CanStop = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        child = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(root, "node.exe"),
            Arguments = "\"" + Path.Combine(root, "host.mjs") + "\"",
            WorkingDirectory = Directory.GetParent(root.TrimEnd('\\')).FullName,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        if (child == null) throw new InvalidOperationException("Unable to start GodMode");
    }

    protected override void OnStop()
    {
        if (child == null || child.HasExited) return;
        child.Kill();
        child.WaitForExit(15000);
        child.Dispose();
        child = null;
    }

    public static void Main()
    {
        ServiceBase.Run(new GodModeService());
    }
}
