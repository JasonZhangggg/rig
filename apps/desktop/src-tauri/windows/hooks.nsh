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
; It also sets up the task that starts Rig's helper with admin rights when Rig
; opens (--helper-task, see helper/RigHelper/HelperTask.cs), so this is the only
; time Windows asks: not again each time Rig opens. Uninstalling removes it. An
; update keeps it, and the new installer's prompt points it at the new helper.
;
; Rig's own setup window (apps/setup) runs this installer silently. When the
; build has it (tools/setup.mjs puts it in src-tauri/setup), a copy goes into
; Rig's folder and Settings, Apps opens it to uninstall, so uninstalling looks
; like Rig too. It runs uninstall.exe silently in turn.

; Read here, not inside a macro: a macro's ${__FILEDIR__} is the folder of the
; file it's used in, which is Tauri's installer.nsi in the build folder.
!define RIG_SETUP_EXE "${__FILEDIR__}\..\setup\rig-setup.exe"

;
; Rig's helper runs with admin rights, so this installer (which doesn't) can't
; close it, and it takes a few seconds to close by itself after Rig does. An
; update from inside Rig starts this installer as Rig closes, so RigHelper.exe
; could still be in use when it was copied, which stopped updates with "Error
; opening file for writing". Windows lets a program that's running be renamed,
; though not replaced, so a RigHelper.exe that's in use is moved aside and the
; new one goes in its place. Moved copies are deleted once they've closed: by
; the next install or update, or by uninstalling.
;
; Rig itself is closed just after this hook. Without a window to ask in
; (silent, as Rig Setup and updates run it, or passive) that always happens; in
; the stock wizard the person may say no, so the helper isn't moved while Rig is
; open there.

!macro NSIS_HOOK_PREINSTALL
  Delete "$INSTDIR\RigHelper-old-*.exe"
  Push $R8
  Push $R9
  StrCpy $R8 0 ; 1 when RigHelper.exe is in use
  ${If} ${FileExists} "$INSTDIR\RigHelper.exe"
    ClearErrors
    FileOpen $R9 "$INSTDIR\RigHelper.exe" a
    ${If} ${Errors}
      StrCpy $R8 1
    ${Else}
      FileClose $R9
    ${EndIf}
  ${EndIf}
  ${If} $R8 = 1
  ${AndIfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ; The stock wizard: only when Rig itself is already closed.
    ClearErrors
    FileOpen $R9 "$INSTDIR\${MAINBINARYNAME}.exe" a
    ${If} ${Errors}
      StrCpy $R8 0
    ${Else}
      FileClose $R9
    ${EndIf}
  ${EndIf}
  ${If} $R8 = 1
    DetailPrint "Rig's helper is still closing, so its old copy is moved aside."
    System::Call 'kernel32::GetTickCount() i .R9'
    Rename "$INSTDIR\RigHelper.exe" "$INSTDIR\RigHelper-old-$R9.exe"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Setting up Rig's background recorder and PawnIO..."
  ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--install-recorder --helper-task --app-dir "$INSTDIR" --pawnio "$INSTDIR\pawnio\PawnIO_setup.exe"' SW_HIDE
  !if /FileExists "${RIG_SETUP_EXE}"
    File "/oname=$INSTDIR\rig-setup.exe" "${RIG_SETUP_EXE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" '"$INSTDIR\rig-setup.exe" --uninstall'
    WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  !endif
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing Rig's background recorder..."
  ; An update reinstalls Rig straight after, so it keeps PawnIO and the helper's task.
  ${If} $UpdateMode = 1
    ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--uninstall-recorder --app-dir "$INSTDIR"' SW_HIDE
  ${Else}
    ExecShellWait "runas" "$INSTDIR\RigHelper.exe" '--uninstall-recorder --helper-task --app-dir "$INSTDIR" --pawnio "$INSTDIR\pawnio\PawnIO_setup.exe"' SW_HIDE
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update puts it straight back. Otherwise, it was the last thing in Rig's folder.
  ${If} $UpdateMode <> 1
    Delete "$INSTDIR\rig-setup.exe"
    ; The helper may still be closing (see the top of this file): give it ten seconds.
    Push $R9
    StrCpy $R9 0
    rig_wait_for_helper:
      Delete "$INSTDIR\RigHelper.exe"
      Delete "$INSTDIR\RigHelper-old-*.exe"
      ${If} ${FileExists} "$INSTDIR\RigHelper*.exe"
      ${AndIf} $R9 < 40
        IntOp $R9 $R9 + 1
        Sleep 250
        Goto rig_wait_for_helper
      ${EndIf}
    Pop $R9
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
