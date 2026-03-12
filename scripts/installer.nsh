!macro customInit
  ; Uninstall previous version
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "UninstallString"
  StrCmp $R0 "" done

  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "A previous version of ${PRODUCT_NAME} was found. It must be uninstalled before proceeding. Click OK to uninstall it." IDOK uninst
  Abort

uninst:
  ClearErrors
  ExecWait '$R0 /S _?=$INSTDIR' ; Do not copy the uninstaller to a temp file
  IfErrors no_remove_uninstaller done
    ; You can either use the built-in Uninstaller or a custom one
no_remove_uninstaller:
  
done:
!macroend
