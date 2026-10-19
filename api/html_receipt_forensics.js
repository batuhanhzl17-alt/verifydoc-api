import { createHash } from 'node:crypto';

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 30000;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))));
}

function normalizeText(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function parseAttributes(tagText) {
  const attrs = {};
  const body = tagText.replace(/^<\/?[\w:-]+|\/?\s*>$/g, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(body))) attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return attrs;
}

function getHtmlSignals(text) {
  const amounts = [...text.matchAll(/(?:₺\s*)?[-+]?\d{1,3}(?:[., ]\d{3})*(?:[.,]\d{1,2})?\s*(?:TL|TRY|₺|EUR|USD|GBP)\b/giu)]
    .map(m => m[0].replace(/\s+/g, ' ').trim()).slice(0, 20);
  const ibans = [...new Set((text.match(/\bTR\s?\d{2}(?:[\s-]?\d){22}\b/gi) || []).map(x => {
    const normalized = x.replace(/[\s-]/g, '').toUpperCase();
    return `${normalized.slice(0, 4)}${'•'.repeat(16)}${normalized.slice(-4)}`;
  }))].slice(0, 10);
  const fieldLabels = ['işlem tutarı', 'islem tutari', 'alıcı', 'alici', 'gönderen', 'gonderen', 'iban', 'tarih', 'sorgu no', 'referans no'];
  return {
    amountCandidates: [...new Set(amounts)],
    ibanCandidates: ibans,
    recognizedFieldLabels: fieldLabels.filter(label => text.toLocaleLowerCase('tr-TR').includes(label)),
  };
}

function normalizeLabel(value) {
  return normalizeText(value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function amountRoleForText(value) {
  const text = normalizeLabel(value);
  if (/\b(?:islem|transaction)\s+tutari?\b/.test(text)) return 'işlem tutarı';
  if (/\b(?:fast|eft|havale)?\s*(?:ucreti|komisyonu|masrafi)\b/.test(text)) return 'ücret/komisyon';
  if (/\bbsmv\b/.test(text)) return 'BSMV';
  if (/\btoplam\b/.test(text)) return 'toplam';
  return null;
}

function cssRulesFrom(styleBlocks) {
  const rules = [];
  for (const block of styleBlocks) {
    for (const match of String(block).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = {};
      for (const declaration of match[2].split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 1) continue;
        declarations[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
      }
      const selectors = match[1].split(',').map(x => x.trim()).filter(Boolean);
      if (Object.keys(declarations).length) rules.push({ selectors, declarations });
    }
  }
  return rules;
}

function selectorMatchesSimple(selector, node) {
  const value = String(selector || '').trim();
  if (!value || /[\s>+~:[\]]/.test(value)) return false;
  const tag = value.match(/^[a-z][\w-]*/i)?.[0]?.toLowerCase();
  if (tag && tag !== node.name) return false;
  const id = value.match(/#([\w-]+)/)?.[1];
  if (id && id !== node.attrs.id) return false;
  const classes = [...value.matchAll(/\.([\w-]+)/g)].map(x => x[1]);
  const nodeClasses = String(node.attrs.class || '').split(/\s+/).filter(Boolean);
  return classes.every(x => nodeClasses.includes(x)) && Boolean(tag || id || classes.length);
}

function styleForNode(node, rules) {
  const computed = {};
  for (const rule of rules) {
    if (rule.selectors.some(selector => selectorMatchesSimple(selector, node))) Object.assign(computed, rule.declarations);
  }
  const inline = String(node.attrs.style || '');
  for (const declaration of inline.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) computed[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
  }
  for (const key of Object.keys(computed)) computed[key] = String(computed[key]).replace(/\s*!important\s*$/i, '').trim();
  return computed;
}

/** Static, non-executing triage for uploaded HTML receipt files. */
export function analyzeHtmlReceipt(buffer, fileName = 'document.html') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('HTML dosyası boş.');
  if (buffer.length > MAX_HTML_BYTES) throw new Error('HTML dosyası 5 MB sınırını aşıyor.');

  const source = buffer.toString('utf8');
  if (source.includes('\u0000')) throw new Error('Dosya geçerli bir metin tabanlı HTML belgesi değil.');
  if (!/<\s*(?:!doctype\s+html|html|head|body|table|div|span)\b/i.test(source)) {
    throw new Error('Dosya HTML belge yapısı olarak doğrulanamadı.');
  }

  const state = {
    visible: [], hidden: [], stack: [], nodes: [], tagCounts: {}, scripts: 0, inlineScripts: 0,
    externalScripts: [], externalResources: [], forms: 0, iframes: 0,
    styleBlocks: [], inlineStyles: [], title: '', generator: '', charset: '',
  };
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+/g) || [];
  let inTitle = false;
  let inStyle = false;
  let inScript = false;
  for (const token of tokens) {
    if (token.startsWith('<!--') || /^<!/i.test(token)) continue;
    if (token[0] !== '<') {
      const text = normalizeText(token);
      if (!text) continue;
      if (inStyle) state.styleBlocks.push(token);
      else if (!inScript) {
        const hidden = state.stack.some(x => x.hidden);
        (hidden ? state.hidden : state.visible).push(text);
        for (const ancestor of state.stack) ancestor.text += `${ancestor.text ? ' ' : ''}${text}`;
        if (inTitle) state.title += `${state.title ? ' ' : ''}${text}`;
      }
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const name = (token.match(/^<\s*\/?\s*([\w:-]+)/) || [,''])[1].toLowerCase();
    if (!name) continue;
    if (closing) {
      if (name === 'title') inTitle = false;
      if (name === 'style') inStyle = false;
      if (name === 'script') inScript = false;
      for (let i = state.stack.length - 1; i >= 0; i--) {
        const item = state.stack.pop();
        if (item.name === name) break;
      }
      continue;
    }
    state.tagCounts[name] = (state.tagCounts[name] || 0) + 1;
    const attrs = parseAttributes(token);
    const style = String(attrs.style || '').toLowerCase().replace(/\s+/g, '');
    const hiddenSelf = Object.hasOwn(attrs, 'hidden') || String(attrs['aria-hidden']).toLowerCase() === 'true' ||
      /(?:^|;)display:none(?:;|$)/.test(style) || /(?:^|;)visibility:hidden(?:;|$)/.test(style) ||
      /(?:^|;)opacity:0(?:\.0+)?(?:;|$)/.test(style);
    const hidden = hiddenSelf || state.stack.some(x => x.hidden);
    if (attrs.style) state.inlineStyles.push(attrs.style);
    if (name === 'title') inTitle = true;
    if (name === 'style') inStyle = true;
    if (name === 'script') {
      state.scripts++;
      inScript = true;
      if (attrs.src) state.externalScripts.push(attrs.src);
      else state.inlineScripts++;
    }
    if (name === 'form') state.forms++;
    if (name === 'iframe') state.iframes++;
    if (name === 'meta') {
      if (attrs.charset) state.charset = attrs.charset;
      if (String(attrs.name).toLowerCase() === 'generator') state.generator = attrs.content || '';
    }
    if (name === 'link' && attrs.href) state.externalResources.push(attrs.href);
    if (['img','iframe','source','video','audio'].includes(name)) {
      for (const key of ['src','poster']) if (attrs[key]) state.externalResources.push(attrs[key]);
    }
    const node = { name, attrs, hidden, text: '', parent: state.stack.at(-1) || null };
    state.nodes.push(node);
    if (!voidTags.has(name) && !/\/\s*>$/.test(token)) state.stack.push(node);
    // Script contents are deliberately not treated as visible receipt text.
    if (inScript) continue;
  }

  const visibleText = state.visible.join(' ').slice(0, MAX_TEXT_CHARS);
  const hiddenText = state.hidden.join(' ').slice(0, MAX_TEXT_CHARS);
  const signals = getHtmlSignals(visibleText);
  const rules = cssRulesFrom(state.styleBlocks);
  const hiddenCssNodes = state.nodes.filter(node => {
    const style = styleForNode(node, rules);
    return /^(?:none)$/i.test(style.display || '') || /^(?:hidden|collapse)$/i.test(style.visibility || '') || /^(?:0|0\.0+|0%)$/i.test(style.opacity || '');
  });
  const cssHiddenText = hiddenCssNodes.map(node => node.text).filter(Boolean).join(' ').slice(0, MAX_TEXT_CHARS);
  const hiddenSignals = getHtmlSignals(`${hiddenText} ${cssHiddenText}`);
  const labeledAmountFields = [];
  const amountStyleProfiles = [];
  for (const row of state.nodes.filter(node => node.name === 'tr' && node.text)) {
    const role = amountRoleForText(row.text);
    if (!role) continue;
    const rowSignals = getHtmlSignals(row.text);
    if (!rowSignals.amountCandidates.length) continue;
    labeledAmountFields.push({ role, amountCandidates: rowSignals.amountCandidates.slice(0, 5) });
    const isWithinRow = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) if (parent === row) return true;
      return false;
    };
    const valueCells = state.nodes.filter(node => node.name === 'td' && isWithinRow(node) &&
      rowSignals.amountCandidates.some(value => normalizeLabel(node.text).includes(normalizeLabel(value))));
    const valueCellProfiles = valueCells.slice(0, 4).map(cell => {
      const style = styleForNode(cell, rules);
      return {
        tag: cell.name,
        classNames: String(cell.attrs.class || '').split(/\s+/).filter(Boolean).slice(0, 6),
        styles: Object.fromEntries(['font-family','font-size','font-weight','color','background-color','position','z-index','transform','opacity'].filter(key => style[key]).map(key => [key, String(style[key]).slice(0, 120)])),
        explicitOverlayStyle: /^(?:absolute|fixed)$/i.test(style.position || '') || Boolean(style.transform) || Boolean(style['z-index']),
      };
    });
    const rowStyle = styleForNode(row, rules);
    amountStyleProfiles.push({
      role,
      tag: row.name,
      classNames: String(row.attrs.class || '').split(/\s+/).filter(Boolean).slice(0, 6),
      rowStyles: Object.fromEntries(['font-family','font-size','font-weight','color','background-color','position','z-index','transform','opacity'].filter(key => rowStyle[key]).map(key => [key, String(rowStyle[key]).slice(0, 120)])),
      valueCells: valueCellProfiles,
      explicitOverlayStyle: valueCellProfiles.some(x => x.explicitOverlayStyle) || /^(?:absolute|fixed)$/i.test(rowStyle.position || '') || Boolean(rowStyle.transform) || Boolean(rowStyle['z-index']),
    });
  }
  const resourceRefs = [...state.externalScripts, ...state.externalResources];
  const embeddedDataResourceCount = resourceRefs.filter(url => /^\s*data:/i.test(url)).length;
  const externalOrigins = [...new Set(resourceRefs.map(url => {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
    } catch { return null; }
  }).filter(Boolean))];
  const externalResourceCount = resourceRefs.filter(url => {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); }
    catch { return false; }
  }).length;
  const findings = [];
  if (state.hidden.length) findings.push({ code: 'hidden-content-present', severity: 'review', detail: 'HTML içinde gizli olarak işaretlenmiş metin bulundu; bu metin tek başına manipülasyon kanıtı değildir.' });
  if (hiddenCssNodes.length) findings.push({ code: 'css-hidden-elements-present', severity: 'review', detail: 'Basit CSS seçicileriyle gizlenmiş öğe bulundu; şablonun meşru tasarımı da benzer stil kullanabilir.' });
  if (amountStyleProfiles.some(item => item.explicitOverlayStyle)) findings.push({ code: 'amount-layout-style-candidate', severity: 'review', detail: 'İşlem tutarı satırında absolute/fixed konum, transform veya z-index stili görüldü; bu biçimlendirme tek başına oynama kanıtı değildir.' });
  const repeatedRoles = [...new Set(labeledAmountFields.filter(item => labeledAmountFields.filter(other => other.role === item.role).length > 1).map(item => item.role))];
  if (repeatedRoles.length) findings.push({ code: 'repeated-labeled-amount-fields', severity: 'review', detail: `Aynı tutar etiketi birden fazla satırda bulundu: ${repeatedRoles.join(', ')}. Doğru alan manuel olarak doğrulanmalıdır.` });
  if (state.externalScripts.length) findings.push({ code: 'external-script-reference', severity: 'info', detail: 'Belge dış JavaScript kaynakları çağırıyor; bu kaynaklar analiz sırasında çalıştırılmadı ve içerikleri doğrulanmadı.' });
  if (state.iframes) findings.push({ code: 'iframe-present', severity: 'info', detail: 'Belgede iframe bulundu; dış veya gömülü içerik statik incelemede görüntülenmedi.' });
  if (state.forms) findings.push({ code: 'form-present', severity: 'info', detail: 'Belgede form alanları bulundu; bu durum dekont verilerinin doğrulandığı anlamına gelmez.' });
  if (!signals.amountCandidates.length) findings.push({ code: 'amount-not-extracted', severity: 'review', detail: 'Görünür metin katmanında güvenilir bir tutar adayı çıkarılamadı.' });

  return {
    available: true,
    engine: 'verifydoc-static-html-forensics-v2',
    status: 'triage-only',
    fileName,
    fileBytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    title: normalizeText(state.title).slice(0, 200) || null,
    declaredGenerator: state.generator.slice(0, 200) || null,
    charset: state.charset || null,
    visibleTextLength: visibleText.length,
    structure: {
      tagCounts: state.tagCounts,
      scriptCount: state.scripts,
      inlineScriptCount: state.inlineScripts,
      externalScriptCount: state.externalScripts.length,
      externalResourceCount,
      embeddedDataResourceCount,
      externalOrigins,
      formCount: state.forms,
      iframeCount: state.iframes,
      explicitlyHiddenTextCharacters: hiddenText.length,
      inlineStyleCount: state.inlineStyles.length,
    },
    visibleFields: signals,
    labeledAmountFields,
    amountStyleProfiles,
    hiddenFieldCandidates: hiddenSignals,
    cssHiddenElementCount: hiddenCssNodes.length,
    findings,
    limitations: [
      'HTML ve JavaScript çalıştırılmadı; harici kaynaklar indirilmedi.',
      'Gizli içerik kontrolü HTML hidden/aria-hidden ve satır içi görünürlük stillerini kapsar; harici CSS seçicileri tam hesaplanmaz.',
      'CSS hesaplaması yalnızca basit etiket/.class/#id seçicilerini kapsar; medya sorguları, sözde seçiciler ve kalıtım çözülmez.',
      'Tutar çevresindeki position/transform/z-index bilgileri aday göstergesidir; gerçek piksel örtüşmesi ölçülmez.',
      'Tarayıcıda oluşan son görünüm ekran görüntüsüyle doğrulanmadı.',
      'HTML metin ve yapı incelemesi tek başına belgenin gerçekliğini veya sahteciliği kanıtlamaz.',
    ],
  };
}

export function formatHtmlReceiptSummary(report) {
  const lines = ['HTML dekont için statik metin ve yapı incelemesi tamamlandı.'];
  if (report?.labeledAmountFields?.length) {
    lines.push(`Etikete bağlanan tutarlar: ${report.labeledAmountFields.slice(0, 5).map(x => `${x.role}: ${x.amountCandidates.join('/')}`).join('; ')}.`);
  } else if (report?.visibleFields?.amountCandidates?.length) {
    lines.push('Tutar adayları bulundu ancak etiketleriyle güvenilir biçimde eşleştirilemedi.');
  }
  if (report?.hiddenFieldCandidates?.amountCandidates?.length || report?.hiddenFieldCandidates?.ibanCandidates?.length) {
    lines.push('Gizli içerikte finansal alan adayı bulundu; görünür içerikle manuel karşılaştırma önerilir.');
  }
  if (!report?.visibleFields?.amountCandidates?.length) lines.push('Görünür metinden tutar çıkarılamadı.');
  lines.push('Bu tarama HTML yapısını inceler; tarayıcı görünümünü oluşturmaz ve sahtecilik kararı vermez.');
  return lines.join('\n');
}
