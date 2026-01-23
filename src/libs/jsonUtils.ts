export function parseJsonWithComments(jsonString: string): any {
    // Remove comments (both single-line and multi-line)
    const withoutComments = jsonString.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(withoutComments);
}
