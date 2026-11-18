; Rig's installer hooks (Tauri's NSIS template includes this file).
;
; Rig installs for the current user, but its background recorder is a Windows
; service, which needs admin rights to add and remove. So after copying Rig the
; installer asks Windows to run the helper with admin rights, and the helper
; installs the recorder (see helper/RigHelper/RecorderSetup.cs). Saying No to
; that prompt only leaves the recorder off; Rig works without it, and it can be
; turned on later in Settings > App.
;
; The uninstaller does the reverse before it removes Rig's files. If its prompt
; is refused, the recorder notices Rig is gone and removes itself within the hour.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Setting up Rig's background recorder..."
  ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--install-recorder --app-dir "$INSTDIR"' SW_HIDE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Rig's background recorder..."
  ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--uninstall-recorder --app-dir "$INSTDIR"' SW_HIDE
!macroend
