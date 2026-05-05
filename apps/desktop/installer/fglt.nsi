; NSIS installer for "Find a Game Like That".
;
; Wraps the Electrobun-emitted bundle at build/stable-win-x64/FindaGameLikeThat/
; in a per-user installer that creates Start Menu shortcuts and a proper
; Apps & Features entry.
;
; Driven by scripts/package-windows.ts which passes:
;   -DVERSION       e.g. 0.2.0
;   -DBUILD_DIR     absolute path to FindaGameLikeThat/ from electrobun build
;   -DOUTPUT_DIR    where to write the .exe
;   -DOUTPUT_NAME   filename for the .exe
;   -DICON          absolute path to assets/icon.ico
;   -DPUBLISHER     publisher string (default "Kevin Batdorf")
;   -DURL           homepage url (default the GitHub repo)

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef PUBLISHER
  !define PUBLISHER "Kevin Batdorf"
!endif
!ifndef URL
  !define URL "https://github.com/KevinBatdorf/fglt"
!endif

; Stable AppUserModelID — set on the Start Menu shortcut at install
; time AND set on the running process at startup. Together these tell
; Windows "this app's identity is X", so taskbar pins / Alt-Tab /
; jump lists track the app by stable id instead of by the bun runtime
; exe path that Windows would otherwise pick (which would pin a bare
; fgl.exe — running it directly just prints Bun's CLI help).
!define APP_AUMID "KevinBatdorf.FindAGameLikeThat"

Name "Find a Game Like That"
OutFile "${OUTPUT_DIR}\${OUTPUT_NAME}"

; Standard per-user install path (same as Discord, Slack, VS Code User
; Installer, GitHub Desktop). Per-user → no UAC. The launcher we ship
; is the real Electrobun launcher (not the self-extracting stub), so
; it just spawns bun.exe in place — no relocation, no bootstrap race.
;
; NOTE: deliberately NO `InstallDirRegKey` — we always want fresh
; installs to land at the default path, even when a prior install
; (e.g. v0.1.0's `fglt.kbatdorf.dev\stable\app\`) left a stale path
; in the registry that would otherwise pre-fill the directory page.
InstallDir "$LOCALAPPDATA\Programs\FindAGameLikeThat"
RequestExecutionLevel user
Unicode true

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName"     "Find a Game Like That"
VIAddVersionKey "CompanyName"     "${PUBLISHER}"
VIAddVersionKey "FileDescription" "Find a Game Like That installer"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "LegalCopyright"  "${PUBLISHER}"

!define MUI_ICON   "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING

; UI pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\bin\launcher.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Find a Game Like That"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; $PLUGINSDIR is an auto-cleaned temp dir for one-shot helpers.
  InitPluginsDir

  ; Wipe app files at $INSTDIR (clean reinstall semantics).
  RMDir /r "$INSTDIR"

  ; Earlier 0.1.x installers wrote app files to other paths. Wipe those
  ; out so a user upgrading from any prior install doesn't end up with
  ; ghost app directories.
  RMDir /r "$LOCALAPPDATA\FindAGameLikeThat"
  RMDir /r "$LOCALAPPDATA\fglt.kbatdorf.dev\stable\app"
  RMDir /r "$LOCALAPPDATA\fglt.kbatdorf.dev\stable\self-extraction"

  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Copy the entire Electrobun bundle. package-windows.ts has already
  ; renamed bin/launcher → bin/launcher.exe and embedded the app icon.
  File /r "${BUILD_DIR}\*.*"

  ; Clean up the legacy bun.exe runtime from pre-fgl.exe installs in
  ; case the prior RMDir couldn't grab it (file locked by an exiting
  ; process). REBOOTOK schedules deletion on next reboot if needed.
  Delete /REBOOTOK "$INSTDIR\bin\bun.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\Find a Game Like That"
  CreateShortcut "$SMPROGRAMS\Find a Game Like That\Find a Game Like That.lnk" \
    "$INSTDIR\bin\launcher.exe" "" "$INSTDIR\bin\launcher.exe" 0
  CreateShortcut "$SMPROGRAMS\Find a Game Like That\Uninstall.lnk" \
    "$INSTDIR\uninstall.exe"

  ; Stamp APP_AUMID onto the launch shortcut. Without this, when the
  ; user pins from the running window, Windows captures the runtime
  ; exe path (fgl.exe) instead of the launcher. fgl.exe is just Bun
  ; with no args → prints CLI help and exits.
  SetOutPath "$PLUGINSDIR"
  File "/oname=set-aumid.ps1" "${__FILEDIR__}\set-shortcut-aumid.ps1"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\set-aumid.ps1" -LnkPath "$SMPROGRAMS\Find a Game Like That\Find a Game Like That.lnk" -Aumid "${APP_AUMID}"'
  Pop $0
  SetOutPath "$INSTDIR"

  ; Apps & Features registration
  WriteRegStr HKCU "Software\FindAGameLikeThat" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\FindAGameLikeThat" "Version"    "${VERSION}"

  !define UNINST_KEY \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\FindAGameLikeThat"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName"     "Find a Game Like That"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout"    "${URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\bin\launcher.exe,0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" \
    "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ; Estimated size for Apps & Features (in KB)
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"

  ; Silent-mode auto-launch. The in-app updater downloads Setup.exe and
  ; runs us with /S; once we've installed the new files we want the new
  ; launcher to start up so the user doesn't have to manually relaunch.
  ; In non-silent (interactive) mode the MUI_FINISHPAGE_RUN button gives
  ; the user the same option, so this Exec only fires under /S.
  ${If} ${Silent}
    Exec '"$INSTDIR\bin\launcher.exe"'
  ${EndIf}
SectionEnd

; Uninstall init — when uninstall.exe is launched from $INSTDIR, copy it
; to %TEMP% and re-launch from there so the Uninstall section can delete
; $INSTDIR (including uninstall.exe itself) without "file in use" errors.
; NSIS's built-in auto-bootstrap is unreliable under /S silent mode, so
; we do this explicitly.
Function un.onInit
  StrCmp "$EXEDIR" "$INSTDIR" 0 done
  StrCpy $1 ""
  ${If} ${Silent}
    StrCpy $1 "/S"
  ${EndIf}
  StrCpy $0 "$TEMP\FindAGameLikeThat-Uninstall.exe"
  CopyFiles /SILENT "$EXEPATH" "$0"
  Exec '"$0" $1 _?=$INSTDIR'
  Quit
done:
FunctionEnd

Section "Uninstall"
  ; Remove app files (this directory). Belt-and-suspenders: explicitly
  ; delete uninstall.exe first in case the OS hasn't released the
  ; original handle yet, then RMDir the rest.
  Delete /REBOOTOK "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR"

  ; Remove WebView2 user data dir + any leftover Electrobun runtime state.
  ; (Cookies, cache, localStorage — tied to the app, not the user.)
  RMDir /r "$LOCALAPPDATA\fglt.kbatdorf.dev"

  ; Shortcuts
  RMDir /r "$SMPROGRAMS\Find a Game Like That"

  ; Apps & Features registry — clean both ours and any leftover
  ; Electrobun-generated entry under the identifier key.
  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\FindAGameLikeThat"
  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\fglt.kbatdorf.dev"
  DeleteRegKey HKCU "Software\FindAGameLikeThat"
SectionEnd
