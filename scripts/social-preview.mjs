export function socialImageUrl(env = process.env) {
    const preview = env.CONTEXT === 'deploy-preview' || env.CONTEXT === 'branch-deploy';
    const base = preview
        ? env.DEPLOY_PRIME_URL || env.DEPLOY_URL
        : env.URL || 'https://wsf.tools';
    if (!base) throw new Error('Missing Netlify preview URL');
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Invalid social preview URL');
    }
    return new URL('/social-preview.png', url.origin).href;
}

export function socialPreviewPlugin(env = process.env) {
    return {
        name: 'social-preview-url',
        transformIndexHtml(html) {
            return html.replaceAll('https://wsf.tools/social-preview.png', socialImageUrl(env));
        },
    };
}
