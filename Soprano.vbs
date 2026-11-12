' Soprano POS - tek tık başlatıcı.
' Sunucu ve yazıcı köprüsünü arka planda başlatır, sistem tepsisine simge koyar.
' Çift tıkla; hiçbir cmd penceresi açılmaz.

Dim sh, fso, root, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\scripts\tray.ps1"""
sh.Run cmd, 0, False
