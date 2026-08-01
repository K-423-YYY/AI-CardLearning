!macro customUnInstall
  nsExec::ExecToLog 'taskkill /IM "AI闯关学习.exe" /F'
  nsExec::ExecToLog 'taskkill /IM "${PRODUCT_NAME}.exe" /F'
!macroend
