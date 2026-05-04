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

Name "Find a Game Like That"
OutFile "${OUTPUT_DIR}\${OUTPUT_NAME}"

; Per-user install — no UAC prompt, same model as Discord/Slack/VS Code User
InstallDir "$LOCALAPPDATA\FindAGameLikeThat"
InstallDirRegKey HKCU "Software\FindAGameLikeThat" "InstallDir"
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
  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Copy the entire Electrobun bundle. package-windows.ts has already
  ; renamed bin/launcher → bin/launcher.exe before invoking us.
  File /r "${BUILD_DIR}\*.*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\Find a Game Like That"
  CreateShortcut "$SMPROGRAMS\Find a Game Like That\Find a Game Like That.lnk" \
    "$INSTDIR\bin\launcher.exe" "" "$INSTDIR\bin\launcher.exe" 0
  CreateShortcut "$SMPROGRAMS\Find a Game Like That\Uninstall.lnk" \
    "$INSTDIR\uninstall.exe"

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
SectionEnd

Section "Uninstall"
  ; Remove app files (everything we installed)
  RMDir /r "$INSTDIR"

  ; Shortcuts
  RMDir /r "$SMPROGRAMS\Find a Game Like That"

  ; Registry — note: we deliberately do NOT touch
  ; %LOCALAPPDATA%\fglt.kbatdorf.dev\ (the app's data dir for prefs /
  ; docker compose state). Users keep their data through reinstalls.
  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\FindAGameLikeThat"
  DeleteRegKey HKCU "Software\FindAGameLikeThat"
SectionEnd
