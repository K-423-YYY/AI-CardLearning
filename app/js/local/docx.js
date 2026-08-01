(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./storage.js'));
  } else {
    root.LocalDocx = factory(root.LocalStorage);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_EXTRACTED_XML = 50 * 1024 * 1024;

  function decodeXml(text) {
    return String(text || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, code) => {
        const n = parseInt(code, 10);
        return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      });
  }

  async function extractText(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('Word 解析组件未加载，请刷新页面重试');
    }
    const zip = await JSZip.loadAsync(arrayBuffer);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('不是有效的 .docx 文件');
    const xml = await entry.async('string');
    if (xml.length > MAX_EXTRACTED_XML) {
      throw new Error('Word 文档内容过大，已超过安全解析范围');
    }
    const text = decodeXml(
      xml
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line, index, arr) => line || arr[index - 1] !== '')
      .join('\n')
      .trim();
    if (!text) throw new Error('Word 文档中没有可读取的文字内容');
    return text;
  }

  return { extractText };
});
