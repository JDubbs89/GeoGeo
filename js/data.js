export async function queryPoints(slider, signal) {
    const response = await fetch(`/api/points?slider=${encodeURIComponent(slider)}`, {signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
}
