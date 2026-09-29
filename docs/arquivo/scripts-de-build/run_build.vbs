Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "E:\short-cta-ai"
objShell.Run "cmd /k npm run build", 1, True
