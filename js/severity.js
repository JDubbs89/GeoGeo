// Percentile bands provide a consistent light-to-dark scale for each pollutant.
export const SEVERITY_LEVELS = [
    {id: 'low', label: 'Low', min: 0, max: 25},
    {id: 'medium', label: 'Medium', min: 25, max: 50},
    {id: 'high', label: 'High', min: 50, max: 75},
    {id: 'very-high', label: 'Very high', min: 75, max: 100},
];

export const POLLUTANTS = [
    {id: 'c02', label: 'CO₂', shades: ['#c7e9c0', '#74c476', '#238b45', '#00441b']},
    {id: 'ch4', label: 'CH₄', shades: ['#fdd0a2', '#fdae6b', '#e6550d', '#7f2704']},
    {id: 'n02', label: 'NO₂', shades: ['#dadaeb', '#9e9ac8', '#756bb1', '#3f007d']},
];

export function pollutantColor(pollutant, percentile) {
    return pollutant.shades[SEVERITY_LEVELS.indexOf(getSeverity(percentile))];
}

export function getSeverity(score) {
    if (!Number.isFinite(score) || score < 0 || score > 100) {
        throw new Error('Severity requires a percentile between 0 and 100.');
    }
    return SEVERITY_LEVELS.find(level => score < level.max) ?? SEVERITY_LEVELS.at(-1);
}
