export async function loadCO2Data(stride = 8) {
    const response = await fetch(`/api/co2?stride=${encodeURIComponent(stride)}`);
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || 'Could not load CO₂ data.');
    }
    return payload;
}