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
;
; The same prompt adds PawnIO, the signed driver processor temperatures and
; board fans are read through, when it's missing or older than the bundled one
; (see helper/RigHelper/PawnIOSetup.cs). Uninstalling removes PawnIO only if
; Rig installed it and no other Rig install remains.
;
; Rig's own setup window (apps/setup) runs this installer silently. When the
; build has it (tools/setup.mjs puts it in src-tauri/setup), a copy goes into
; Rig's folder and Settings, Apps opens it to uninstall, so uninstalling looks
; like Rig too. It runs uninstall.exe silently in turn.

; Read here, not inside a macro: a macro's ${__FILEDIR__} is the folder of the
; file it's used in, which is Tauri's installer.nsi in the build folder.
!define RIG_SETUP_EXE "${__FILEDIR__}\..\setup\rig-setup.exe"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Setting up Rig's background recorder and PawnIO..."
  ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--install-recorder --app-dir "$INSTDIR" --pawnio "$INSTDIR\pawnio\PawnIO_setup.exe"' SW_HIDE
  !if /FileExists "${RIG_SETUP_EXE}"
    File "/oname=$INSTDIR\rig-setup.exe" "${RIG_SETUP_EXE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" '"$INSTDIR\rig-setup.exe" --uninstall'
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  !endif
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Rig's background recorder..."
  ; An update reinstalls Rig straight after, so it keeps PawnIO.
  ${If} $UpdateMode = 1
    ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--uninstall-recorder --app-dir "$INSTDIR"' SW_HIDE
  ${Else}
    ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--uninstall-recorder --app-dir "$INSTDIR" --pawnio "$INSTDIR\pawnio\PawnIO_setup.exe"' SW_HIDE
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update puts it straight back. Otherwise, it was the last thing in Rig's folder.
  ${If} $UpdateMode <> 1
    Delete "$INSTDIR\rig-setup.exe"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
