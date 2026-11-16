export async function queryPoints(slider, signal, pollutant) {
    const selection = pollutant === undefined ? '' : `&pollutant=${encodeURIComponent(pollutant)}`;
    const response = await fetch(`/api/points?slider=${encodeURIComponent(slider)}${selection}`, {signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
}
