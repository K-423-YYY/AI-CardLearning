(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalExport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function safeFilename(name) {
    return String(name || 'file')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80);
  }

  async function buildFullZip(core) {
    if (typeof JSZip === 'undefined') throw new Error('备份组件未加载，请刷新页面重试');
    const data = await core.collectExportData();
    const zip = new JSZip();
    const manifest = {
      format_version: 1,
      app_version: '0.1.3',
      exported_at: new Date().toISOString(),
      export_type: 'full',
      source_app: 'ai-learn-local'
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('data.json', JSON.stringify(data, null, 2));
    const files = zip.folder('files');
    (data.files || []).forEach((f) => {
      files.file(`${f.id}_${safeFilename(f.filename)}`, String(f.content || ''));
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const stamp = new Date().toISOString().slice(0, 10);
    return { blob, filename: `AI闯关学习备份-${stamp}.zip` };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { buildFullZip, downloadBlob, safeFilename };
});
