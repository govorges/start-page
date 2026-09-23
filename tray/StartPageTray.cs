// Start Page's icon in the taskbar tray. launcher.js builds this with the C# compiler that comes with
// Windows (see lib/tray.js) and runs it once the server is ready.
//   Left click: open the start page. Right click: Start Page (title) / Open / Settings / Exit.
// It writes one word per line to stdout ("open", "settings", "exit") for launcher.js to act on, and
// quits when launcher.js closes its stdin (the server stopped), so it never outlives the server.
// Usage: StartPageTray.exe <icon.ico>. Built with /define:TEST it is the test copy's ("Start Page (Test)").
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

#if TEST
[assembly: AssemblyTitle("Start Page (Test)")]
#else
[assembly: AssemblyTitle("Start Page")]
#endif
[assembly: AssemblyProduct("Start Page")]
[assembly: AssemblyDescription("Start Page tray icon")]
[assembly: AssemblyVersion("2.0.0.0")]

static class StartPageTray
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    static NotifyIcon tray;
#if TEST
    const string Name = "Start Page (Test)";
#else
    const string Name = "Start Page";
#endif

    [STAThread]
    static void Main(string[] args)
    {
        SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Icon small = LoadIcon(args.Length > 0 ? args[0] : null, SystemInformation.SmallIconSize);
        Icon menuIcon = LoadIcon(args.Length > 0 ? args[0] : null, new Size(Scale(16), Scale(16)));

        var menu = new ContextMenuStrip { Renderer = new DarkRenderer(), ShowImageMargin = true, Padding = new Padding(0, Scale(4), 0, Scale(4)) };
        menu.Font = new Font("Segoe UI", 9f);
        var title = new ToolStripMenuItem(Name, menuIcon.ToBitmap()) { Enabled = false };
        var open = new ToolStripMenuItem("Open", null, (s, e) => Send("open"));
        open.Font = new Font(menu.Font, FontStyle.Bold);
        menu.Items.Add(title);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(open);
        menu.Items.Add(new ToolStripMenuItem("Settings", null, (s, e) => Send("settings")));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Exit", null, (s, e) => Send("exit")));
        foreach (ToolStripItem item in menu.Items)
            if (item is ToolStripMenuItem) item.Padding = new Padding(0, Scale(3), Scale(12), Scale(3));

        tray = new NotifyIcon { Icon = small, Text = Name, ContextMenuStrip = menu, Visible = true };
        tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) Send("open"); };

        // Quit when launcher.js goes away (its end of stdin closes).
        var ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        var watch = new Thread(() =>
        {
            try { while (Console.In.ReadLine() != null) { } } catch { }
            ui.Post(_ => Quit(), null);
        }) { IsBackground = true };
        watch.Start();

        Application.Run();
    }

    static void Send(string command)
    {
        try { Console.Out.WriteLine(command); Console.Out.Flush(); }
        catch { Quit(); } // nobody is listening any more
    }

    static void Quit()
    {
        tray.Visible = false; // otherwise the icon lingers until the mouse passes over it
        tray.Dispose();
        Application.Exit();
    }

    static int Scale(int px)
    {
        using (var g = Graphics.FromHwnd(IntPtr.Zero)) return (int)Math.Round(px * g.DpiX / 96f);
    }

    static Icon LoadIcon(string file, Size size)
    {
        try { if (file != null) return new Icon(file, size); } catch { }
        return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    }

    // Colors from the start page itself (public/app.css).
    sealed class DarkRenderer : ToolStripProfessionalRenderer
    {
        static readonly Color Surface = ColorTranslator.FromHtml("#0e1725");
        static readonly Color Hover = ColorTranslator.FromHtml("#1d2a40");
        static readonly Color Line = ColorTranslator.FromHtml("#303743");
        static readonly Color Ink = ColorTranslator.FromHtml("#eef1f7");
        static readonly Color Muted = ColorTranslator.FromHtml("#8089a0");

        public DarkRenderer() : base(new Colors()) { RoundedEdges = false; }

        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
        {
            using (var b = new SolidBrush(Surface)) e.Graphics.FillRectangle(b, e.AffectedBounds);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            var r = e.AffectedBounds; r.Width--; r.Height--;
            using (var p = new Pen(Line)) e.Graphics.DrawRectangle(p, r);
        }

        protected override void OnRenderImageMargin(ToolStripRenderEventArgs e) { }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (!e.Item.Selected || !e.Item.Enabled) return;
            var r = new Rectangle(4, 1, e.Item.Width - 8, e.Item.Height - 2);
            using (var b = new SolidBrush(Hover)) e.Graphics.FillRectangle(b, r);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Enabled ? Ink : Muted;
            base.OnRenderItemText(e);
        }

        protected override void OnRenderItemImage(ToolStripItemImageRenderEventArgs e)
        {
            // Draw the ~/ mark in full color even though the title item is disabled.
            if (e.Image == null) return;
            e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            e.Graphics.DrawImage(e.Image, e.ImageRectangle);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            int y = e.Item.Height / 2;
            using (var p = new Pen(Line)) e.Graphics.DrawLine(p, 4, y, e.Item.Width - 4, y);
        }
    }

    sealed class Colors : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground { get { return ColorTranslator.FromHtml("#0e1725"); } }
        public override Color ImageMarginGradientBegin { get { return ColorTranslator.FromHtml("#0e1725"); } }
        public override Color ImageMarginGradientMiddle { get { return ColorTranslator.FromHtml("#0e1725"); } }
        public override Color ImageMarginGradientEnd { get { return ColorTranslator.FromHtml("#0e1725"); } }
        public override Color MenuBorder { get { return ColorTranslator.FromHtml("#303743"); } }
        public override Color MenuItemBorder { get { return Color.Transparent; } }
        public override Color MenuItemSelected { get { return ColorTranslator.FromHtml("#1d2a40"); } }
    }
}
