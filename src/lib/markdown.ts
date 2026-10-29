import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { LinkPreview } from './types';
export function extractUrls(body: string): string[] {
  const ast = unified().use(remarkParse).use(remarkGfm).parse(body); const urls = new Set<string>();
  visit(ast, (node: any) => { if (['link','image'].includes(node.type) && /^https:\/\//.test(node.url)) urls.add(node.url); });
  return [...urls].slice(0, 8);
}
export async function markdown(body: string, previews: LinkPreview[] = []): Promise<string> {
  const images = new Map(previews.filter(p => p.kind === 'image').map(p => [p.url,p]));
  const imageFor = (value:string) => {
    try { const url=new URL(value);url.hash='';return images.get(url.href); }
    catch { return undefined; }
  };
  const processor = unified().use(remarkParse).use(remarkGfm).use(() => (tree: any) => {
    visit(tree, (node: any, index: number|undefined, parent: any) => {
      if (!parent || index === undefined) return;
      if (node.type === 'image') {
        const image = imageFor(node.url);
        if (image) node.url = `/api/media/${image.id}`;
        else parent.children[index] = {type:'text',value:node.alt || 'Image unavailable'};
      }
      if (node.type === 'link' && parent.type === 'paragraph' && node.children?.length===1 && node.children[0]?.value === node.url) {
        const image = imageFor(node.url);
        if (image) parent.children[index] = { type:'image',url:`/api/media/${image.id}`,alt:'External image',title:null };
      }
    });
  }).use(remarkRehype).use(rehypeSanitize, {
    ...defaultSchema, attributes: {...defaultSchema.attributes, img:['src','alt','title','loading','decoding','width','height'], a:['href','title','rel','target']},
  }).use(() => (tree: any) => {
    visit(tree,'element',(node: any) => {
      if (node.tagName === 'a') { node.properties.rel = ['ugc','nofollow','noopener']; node.properties.target = '_blank'; }
      if (node.tagName === 'img') { node.properties.loading = 'lazy'; node.properties.decoding = 'async'; node.properties.width = 600; node.properties.height = 360; }
    });
  }).use(rehypeStringify);
  return String(await processor.process(body));
}
