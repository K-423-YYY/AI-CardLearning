(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalImport = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  async function parseZip(arrayBuffer) {
    if (typeof JSZip === 'undefined') throw new Error('导入组件未加载，请刷新页面重试');
    const zip = await JSZip.loadAsync(arrayBuffer);
    const manifestFile = zip.file('manifest.json');
    const dataFile = zip.file('data.json');
    if (!manifestFile || !dataFile) throw new Error('不是有效的 AI 闯关学习备份文件');
    const manifest = JSON.parse(await manifestFile.async('string'));
    if (manifest.format_version !== 1) {
      throw new Error('备份格式版本不兼容，请升级应用后再导入');
    }
    const data = JSON.parse(await dataFile.async('string'));
    const filesMap = {};
    const folder = zip.folder('files');
    if (folder) {
      const entries = Object.keys(folder.files).filter((name) => !folder.files[name].dir);
      for (const name of entries) {
        const match = name.match(/^files\/(\d+)_/);
        if (match) {
          filesMap[Number(match[1])] = await folder.files[name].async('string');
        }
      }
    }
    return { manifest, data, filesMap };
  }

  return { parseZip };
});
