// Installations-Assistent beim ersten Doppelklick auf nbhelper.exe (Installer.Interactive): Willkommen → Admin der
// Web-Oberfläche anlegen → Installieren (pro Benutzer, ohne Adminrechte) und Netz-Modus starten → Fertig: öffnet die
// Web-Oberfläche mit dem Einrichtungs-Assistenten (#wizard: Funktionen, Speicher, Netz, Geräte koppeln).
// Das Passwort geht nur an Users.Add in diesem Prozess (nie auf eine Befehlszeile oder ins Protokoll).
// Aktualisieren und Entfernen laufen weiter über die Rückfragen in Installer.cs.
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace NovaBird.Helper;

sealed class SetupWizard : Form
{
    readonly Panel body = new() { Dock = DockStyle.Fill, Padding = new Padding(24, 20, 24, 8) };
    readonly Button back = new() { AutoSize = true }, next = new() { AutoSize = true }, cancel = new() { AutoSize = true };
    readonly TextBox name = new() { Width = 260, Text = "admin" };
    readonly TextBox pw1 = new() { Width = 260, UseSystemPasswordChar = true }, pw2 = new() { Width = 260, UseSystemPasswordChar = true };
    readonly Label error = new() { AutoSize = true, ForeColor = Color.Firebrick, MaximumSize = new Size(480, 0) };
    readonly bool needAdmin = !Users.Any(); // Neuinstallation nach früherer: vorhandene Benutzer bleiben
    int step;
    public bool Done { get; private set; }

    SetupWizard()
    {
        Text = "NovaBird Helper " + Program.Version;
        Font = SystemFonts.MessageBoxFont;
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 440);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath); } catch { /* ohne Symbol */ }
        var bar = new FlowLayoutPanel { Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Padding = new Padding(12) };
        cancel.Text = L.T("Abbrechen", "Cancel");
        back.Text = L.T("< Zurück", "< Back");
        bar.Controls.AddRange(new Control[] { cancel, next, back });
        Controls.Add(body);
        Controls.Add(bar);
        cancel.Click += (_, _) => Close();
        back.Click += (_, _) => ShowPage(step - 1);
        next.Click += (_, _) => Next();
        AcceptButton = next;
        ShowPage(0);
    }

    public static int Run()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using var f = new SetupWizard();
        Application.Run(f);
        return f.Done ? 0 : 1;
    }

    /// <summary>Test: Seiten Willkommen, Admin und Fertig als Bilder speichern, ohne etwas zu installieren (--test-setup-shots).</summary>
    public static int Shots(string dir)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        using var f = new SetupWizard { StartPosition = FormStartPosition.Manual, Location = new Point(-4000, -4000), ShowInTaskbar = false };
        f.Show(); // außerhalb des Bildschirms: nur so ordnet das Fenster seine Inhalte an
        Application.DoEvents();
        foreach (var (s, file) in new[] { (0, "setup-1-willkommen"), (1, "setup-2-admin"), (3, "setup-3-fertig") })
        {
            f.step = s - 1;
            f.ShowPage(s);
            if (s == 1) f.error.Text = L.T("Die Passwörter sind verschieden.", "The passwords differ.");
            f.PerformLayout();
            Application.DoEvents();
            using var bmp = new Bitmap(f.Width, f.Height);
            f.DrawToBitmap(bmp, new Rectangle(0, 0, f.Width, f.Height));
            bmp.Save(Path.Combine(dir, file + ".png"), System.Drawing.Imaging.ImageFormat.Png);
        }
        return 0;
    }

    // Schritte: 0 Willkommen, 1 Admin (nur ohne vorhandene Benutzer), 2 Installieren, 3 Fertig
    void ShowPage(int s)
    {
        if (s == 1 && !needAdmin) s = step < 1 ? 2 : 0;
        step = s;
        body.Controls.Clear();
        error.Text = "";
        back.Visible = s is 1 or 2 && s > 0;
        cancel.Visible = s < 3;
        next.Enabled = true;
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        Control Head(string t) => new Label { Text = t, AutoSize = true, Font = new Font(Font.FontFamily, Font.Size * 1.5f, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
        Control Text(string t) => new Label { Text = t, AutoSize = true, MaximumSize = new Size(500, 0), Margin = new Padding(0, 0, 0, 10) };
        switch (s)
        {
            case 0:
                flow.Controls.Add(Head(L.T("NovaBird Helper installieren", "Install NovaBird Helper")));
                flow.Controls.Add(Text(L.T(
                    "Der Helper rechnet für NovaBird in Thunderbird auf der Grafikkarte: Bedeutungssuche, KI-Assistent mit eigenem Sprachmodell, Vorlesen und Team-Kalender – für diesen PC und auf Wunsch für weitere PCs im Netz.",
                    "The helper computes for NovaBird in Thunderbird on the graphics card: meaning search, AI assistant with its own language model, reading aloud and team calendars – for this PC and, if you like, for other PCs in the network.")));
                flow.Controls.Add(Text(L.T(
                    "Installiert wird nur für diesen Windows-Benutzer, ohne Adminrechte, nach:\n",
                    "It is installed for this Windows user only, without admin rights, to:\n") + Installer.InstallDirPath));
                flow.Controls.Add(Text(L.T(
                    "Danach öffnet sich die Web-Oberfläche des Helpers und fragt, was er machen soll. Modelle werden erst dort geladen.",
                    "Afterwards the helper's web interface opens and asks what it should do. Models are only downloaded there.")));
                next.Text = L.T("Weiter >", "Next >");
                break;
            case 1:
                flow.Controls.Add(Head(L.T("Zugang zur Web-Oberfläche", "Access to the web interface")));
                flow.Controls.Add(Text(L.T(
                    "Die Einstellungen des Helpers stehen in einer Web-Oberfläche. Lege dafür einen Admin an. Name und Passwort gelten nur dort, nicht für Windows. Passwort mindestens 10 Zeichen.",
                    "The helper's settings are in a web interface. Create an admin for it. Name and password apply only there, not to Windows. Password at least 10 characters.")));
                foreach (var (label, box) in new[] { (L.T("Name", "Name"), name), (L.T("Passwort", "Password"), pw1), (L.T("Passwort wiederholen", "Repeat password"), pw2) })
                {
                    flow.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 6, 0, 2) });
                    flow.Controls.Add(box);
                }
                flow.Controls.Add(error);
                next.Text = L.T("Installieren", "Install");
                break;
            case 2:
                flow.Controls.Add(Head(L.T("Installieren …", "Installing …")));
                flow.Controls.Add(error);
                next.Enabled = back.Visible = cancel.Visible = false;
                break;
            case 3:
                flow.Controls.Add(Head(L.T("Fertig", "Done")));
                flow.Controls.Add(Text(L.T(
                    "Der Helper ist installiert und läuft (Symbol im Infobereich). Im nächsten Schritt öffnet sich die Web-Oberfläche: dort anmelden, dann fragt ein Assistent, was der Helper machen soll, wie lange er Modelle im Speicher hält, ob er im Netz erreichbar ist – und zum Schluss, welche Geräte du hinzufügen möchtest.",
                    "The helper is installed and running (icon in the notification area). Next, the web interface opens: sign in there, then an assistant asks what the helper should do, how long it keeps models in memory, whether it is reachable in the network – and finally which devices you want to add.")));
                flow.Controls.Add(Text(L.T(
                    "In Thunderbird: Einstellungen → NovaBird → KI → NovaBird Helper → „Helper im Netz suchen“.",
                    "In Thunderbird: Settings → NovaBird → AI → NovaBird Helper → “Search the network for a helper”.")));
                next.Text = L.T("Web-Oberfläche öffnen", "Open web interface");
                break;
        }
        body.Controls.Add(flow);
        if (s == 1) BeginInvoke(() => (string.IsNullOrEmpty(pw1.Text) ? pw1 : name).Focus());
        if (s == 2 && IsHandleCreated) BeginInvoke(Install);
    }

    void Next()
    {
        if (step == 0) { ShowPage(1); return; }
        if (step == 1)
        {
            if (pw1.Text != pw2.Text) { error.Text = L.T("Die Passwörter sind verschieden.", "The passwords differ."); return; }
            if (Users.PasswordProblem(pw1.Text) is string p) { error.Text = p; return; }
            if (!Users.NameOk(name.Text.Trim())) { error.Text = L.T("Name: 2–40 Zeichen, Buchstaben, Ziffern und . _ @ -", "Name: 2–40 characters, letters, digits and . _ @ -"); return; }
            ShowPage(2);
            return;
        }
        if (step == 3)
        {
            Done = true;
            try { Process.Start(new ProcessStartInfo($"http://localhost:{Core.WebPortSetting}/#wizard") { UseShellExecute = true }); } catch { /* Browser fehlt */ }
            Close();
        }
    }

    async void Install()
    {
        try
        {
            UseWaitCursor = true;
            if (!Installer.Install(quiet: true)) throw new InvalidOperationException(L.T("Kopieren fehlgeschlagen (siehe helper.log).", "Copying failed (see helper.log)."));
            if (needAdmin && !Users.Any()) Users.Add(name.Text.Trim(), pw1.Text, Users.Admin);
            pw1.Text = pw2.Text = "";
            // Netz-Modus starten (Symbol im Infobereich, Web-Oberfläche) und warten, bis die Oberfläche antwortet
            if (!Service.IsInstalled())
                Process.Start(new ProcessStartInfo(Installer.InstalledExePath, "--server") { UseShellExecute = false });
            using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            for (int i = 0; i < 40; i++)
            {
                try { if ((await http.GetAsync($"http://localhost:{Core.WebPortSetting}/api/ping")).IsSuccessStatusCode) break; } catch { /* startet noch */ }
                await Task.Delay(500);
            }
            Log.Write("Installations-Assistent: fertig");
            UseWaitCursor = false;
            ShowPage(3);
        }
        catch (Exception e)
        {
            UseWaitCursor = false;
            Log.Write("Installations-Assistent: " + e);
            error.Text = L.T("Installation fehlgeschlagen: ", "Installation failed: ") + e.Message;
            cancel.Visible = true;
            cancel.Text = L.T("Schließen", "Close");
        }
    }
}
