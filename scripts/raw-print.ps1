param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)

# Windows yazıcı kuyruğuna ham (raw) ESC/POS baytları gönderir.
# Sürücü "Generic / Text Only" olsa da fiş doğru basılır; sürücü baytları
# yeniden yorumlamaz, doğrudan spooler'a yazar.
$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class SopranoRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void SendFile(string printerName, string path) {
        byte[] bytes = File.ReadAllBytes(path);
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("Yazici acilamadi: " + printerName + " (hata " + Marshal.GetLastWin32Error() + ")");

        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Soprano POS";
        di.pDataType = "RAW";

        try {
            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("Dokuman baslatilamadi (hata " + Marshal.GetLastWin32Error() + ")");
            try {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("Sayfa baslatilamadi (hata " + Marshal.GetLastWin32Error() + ")");
                IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
                try {
                    Marshal.Copy(bytes, 0, p, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, p, bytes.Length, out written))
                        throw new Exception("Yazma basarisiz (hata " + Marshal.GetLastWin32Error() + ")");
                    if (written != bytes.Length)
                        throw new Exception("Eksik yazildi: " + written + "/" + bytes.Length);
                } finally {
                    Marshal.FreeCoTaskMem(p);
                }
                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
'@

if (-not ("SopranoRawPrinter" -as [type])) {
  Add-Type -TypeDefinition $code -Language CSharp
}

[SopranoRawPrinter]::SendFile($PrinterName, $FilePath)
