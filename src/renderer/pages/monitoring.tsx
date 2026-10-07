import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FiChevronDown, FiX } from 'react-icons/fi';
import { ContainerStats } from '@common/types';
import { useContainers } from '@renderer/hooks/useContainers';
import Spinner from '@components/spinner';
import ColimaDown from '@components/colimadown';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { appendSample, axisMaximum, formatBytes, Sample, timeWindow } from './monitoringData';
import './monitoring.scss';

const COLORS = ['#67c8f0', '#8bd5a0', '#e8b86d', '#b59af3', '#ee93b2', '#66d6cc', '#e9857d', '#bbc875'];
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const percent = (value: number) => `${Number(value.toFixed(1))}%`;

type Metric = 'cpu' | 'memory' | 'network' | 'disk';
const METRICS: { metric: Metric; title: string; description: string }[] = [
    { metric: 'cpu', title: 'CPU', description: 'Utilization' },
    { metric: 'memory', title: 'Memory', description: 'Percentage of container limit' },
    { metric: 'network', title: 'Network I/O', description: 'Transfer rate' },
    { metric: 'disk', title: 'Disk I/O', description: 'Block device read/write rate' },
];

interface ChartSeries {
    id: string;
    name: string;
    color: string;
    key: 'cpu' | 'memory' | 'rx' | 'tx' | 'read' | 'write';
    samples: Sample[];
    selected: boolean;
    project?: string;
}

/** Slide the time scale instead of replaying Recharts' line animations. */
function useSlidingRange(target: [number, number] | null, reducedMotion: boolean) {
    const [display, setDisplay] = useState<[number, number] | null>(null);
    const current = useRef<[number, number] | null>(null);
    const start = target?.[0];
    const end = target?.[1];
    useEffect(() => {
        if (start === undefined || end === undefined) return;
        const from = current.current;
        if (!from || reducedMotion || from[1] === end) {
            current.current = [start, end];
            setDisplay(current.current);
            return;
        }
        let frame = 0;
        const began = performance.now();
        const slide = (now: number) => {
            const progress = Math.min(1, (now - began) / 450);
            const eased = 1 - Math.pow(1 - progress, 3);
            current.current = [from[0] + (start - from[0]) * eased, from[1] + (end - from[1]) * eased];
            setDisplay(current.current);
            if (progress < 1) frame = requestAnimationFrame(slide);
        };
        frame = requestAnimationFrame(slide);
        return () => cancelAnimationFrame(frame);
    }, [start, end, reducedMotion]);
    return display;
}

function ResourceChart({ metric, series, range, reducedMotion }: {
    metric: Metric; series: ChartSeries[]; range: [number, number]; reducedMotion: boolean;
}) {
    const isRate = metric === 'network' || metric === 'disk';
    const format = isRate ? (value: number) => `${formatBytes(value)}/s` : percent;
    const timeline = Array.from(new Set(series.flatMap(line => line.samples.map(sample => sample.timestamp))))
        .sort((a, b) => a - b).map(timestamp => ({ timestamp }));
    const values = series.flatMap(line => line.samples.filter(sample => sample.timestamp >= range[0])
        .map(sample => sample[line.key]).filter((value): value is number => value !== null));
    const maximum = axisMaximum(values);
    const ticks = Array.from({ length: 5 }, (_, index) => range[0] + (range[1] - range[0]) * index / 4);

    return (
        <div className="resource-chart" role="img" aria-label={`${metric} usage over time`}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timeline} margin={{ top: 12, right: 28, bottom: 4, left: 8 }} accessibilityLayer>
                    <defs>
                        {series.map(line => (
                            <linearGradient id={`fill-${metric}-${line.id}-${line.key}`} key={`${line.id}-${line.key}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={line.color} stopOpacity={0.22} />
                                <stop offset="95%" stopColor={line.color} stopOpacity={0.01} />
                            </linearGradient>
                        ))}
                    </defs>
                    <CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.06} strokeDasharray="3 6" />
                    <XAxis dataKey="timestamp" type="number" scale="time" domain={range} ticks={ticks} allowDataOverflow
                        tickFormatter={value => clock.format(value)} tick={{ fill: '#8392a5', fontSize: 10 }}
                        axisLine={false} tickLine={false} tickMargin={12} minTickGap={32} />
                    <YAxis allowDataOverflow domain={[0, maximum]} ticks={[0, maximum / 4, maximum / 2, maximum * 3 / 4, maximum]}
                        width={isRate ? 78 : 52} tickFormatter={format}
                        tick={{ fill: '#8392a5', fontSize: 10 }} axisLine={false} tickLine={false} tickMargin={10} />
                    <Tooltip isAnimationActive={!reducedMotion} animationDuration={180}
                        cursor={{ stroke: '#adbed2', strokeOpacity: 0.35, strokeDasharray: '4 4' }}
                        content={({ active, label }) => {
                            if (!active || typeof label !== 'number') return null;
                            return <div className="chart-tooltip"><time>{clock.format(label)}</time>
                                {series.map(line => {
                                    const sample = line.samples.reduce<Sample | null>((closest, point) =>
                                        !closest || Math.abs(point.timestamp - label) < Math.abs(closest.timestamp - label) ? point : closest, null);
                                    if (!sample || Math.abs(sample.timestamp - label) > 3000 || sample[line.key] === null) return null;
                                    return <div key={`${line.id}-${line.key}`}><span className="tooltip-name"><i style={{ background: line.color }} /><span>{line.name}{line.project && <small>{line.project}</small>}</span></span>
                                        <strong>{format(sample[line.key] as number)}</strong></div>;
                                })}
                            </div>;
                        }} />
                    {series.map(line => {
                        const common = {
                            data: line.samples, dataKey: line.key, name: line.name, type: 'monotoneX' as const,
                            stroke: line.color, strokeWidth: line.selected ? 2.5 : 2,
                            style: { filter: line.selected ? `drop-shadow(0 0 3px ${line.color}55)` : undefined },
                            dot: line.samples.length === 1 ? { r: 3, fill: line.color, strokeWidth: 0 } : false,
                            activeDot: { r: 4, fill: line.color, stroke: '#17212d', strokeWidth: 3, style: { filter: `drop-shadow(0 0 5px ${line.color})` } },
                            isAnimationActive: false,
                            connectNulls: false,
                        };
                        return isRate ? (
                            <Line key={`${line.id}-${line.key}`} {...common} strokeDasharray={line.key === 'tx' || line.key === 'write' ? '5 4' : undefined} />
                        ) : (
                            <Area key={`${line.id}-${line.key}`} {...common} fill={`url(#fill-${metric}-${line.id}-${line.key})`} fillOpacity={1} />
                        );
                    })}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

const Monitoring = () => {
    const { containers, isLoading, isColimaStopped, runningContainers } = useContainers();
    const [history, setHistory] = useState<Record<string, Sample[]>>({});
    const [range, setRange] = useState<[number, number] | null>(null);
    const [error, setError] = useState('');
    const [reducedMotion, setReducedMotion] = useState(false);
    const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set());
    const [expandedGraphs, setExpandedGraphs] = useState<Set<Metric>>(new Set());
    const chipRefs = useRef(new Map<string, HTMLButtonElement>());
    const chipPositions = useRef(new Map<string, DOMRect>());
    const graphRefs = useRef(new Map<Metric, HTMLElement>());
    const graphPositions = useRef(new Map<Metric, DOMRect>());
    const initialRange = useRef(timeWindow(Date.now(), Date.now()));
    const sessionStart = useRef<number | null>(null);
    const latestTimestamp = useRef(0);
    const colors = useRef(new Map<string, string>());
    const activeIds = useRef(new Set<string>());
    const containersLoaded = useRef(false);
    containersLoaded.current = !isLoading;
    activeIds.current = new Set(runningContainers.map(container => container.id));

    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReducedMotion(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    useEffect(() => {
        let disposed = false;
        let hydrating = true;
        const pending: ContainerStats[] = [];
        const ingest = (samples: ContainerStats[]) => {
            const valid = samples.filter(stats => Number.isFinite(stats.timestamp)
                && (!containersLoaded.current || activeIds.current.has(stats.containerId)))
                .sort((a, b) => a.timestamp - b.timestamp);
            if (!valid.length || disposed) return;
            sessionStart.current = sessionStart.current ?? valid[0].timestamp;
            latestTimestamp.current = Math.max(latestTimestamp.current, valid[valid.length - 1].timestamp);
            setRange(timeWindow(sessionStart.current, latestTimestamp.current));
            setHistory(prev => {
                const next = { ...prev };
                for (const stats of valid) next[stats.containerId] = appendSample(next[stats.containerId] || [], stats);
                return next;
            });
        };
        const removeListener = window.api.onContainerStats((_event, stats: ContainerStats) => {
            if (disposed) return;
            if (hydrating) pending.push(stats);
            else ingest([stats]);
        });
        window.api.getContainerStatsHistory().then(snapshot => {
            if (disposed) return;
            sessionStart.current = snapshot.startedAt;
            ingest([...snapshot.samples, ...pending]);
        }).catch(err => {
            console.error('Failed to load monitoring history:', err);
            if (!disposed) {
                setError('Could not load recent history. Live monitoring is still available.');
                ingest(pending);
            }
        }).finally(() => { hydrating = false; });
        return () => {
            disposed = true;
            removeListener();
        };
    }, []);

    const displayedRange = useSlidingRange(range, reducedMotion);
    const activeContainerKey = runningContainers.map(container => container.id).join(',');

    useEffect(() => {
        if (isLoading) return;
        setHistory(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.current.has(id))));
        setSelectedContainers(prev => new Set([...prev].filter(id => activeIds.current.has(id))));
    }, [activeContainerKey, isLoading]);

    const keyedContainers = useMemo(() => runningContainers.map(container => {
        if (!colors.current.has(container.id)) colors.current.set(container.id, COLORS[colors.current.size % COLORS.length]);
        return { ...container, displayName: container.composeService || container.name, color: colors.current.get(container.id) || COLORS[0] };
    }), [containers]);

    const chipOrder = new Map(Array.from(selectedContainers, (id, index) => [id, index]));
    const orderedContainers = [...keyedContainers].sort((a, b) =>
        (chipOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (chipOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    const selectedCount = keyedContainers.filter(container => selectedContainers.has(container.id)).length;
    const visibleContainers = selectedCount ? keyedContainers.filter(container => selectedContainers.has(container.id)) : keyedContainers;

    const captureChipPositions = () => {
        chipPositions.current = new Map(Array.from(chipRefs.current, ([id, element]) => [id, element.getBoundingClientRect()]));
    };
    const toggleContainer = (id: string) => {
        captureChipPositions();
        setSelectedContainers(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    useLayoutEffect(() => {
        const animations: Animation[] = [];
        if (!reducedMotion) chipRefs.current.forEach((element, id) => {
            const previous = chipPositions.current.get(id);
            if (!previous) return;
            const position = element.getBoundingClientRect();
            const x = previous.left - position.left;
            const y = previous.top - position.top;
            if (x || y) animations.push(element.animate([
                { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
            ], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' }));
        });
        chipPositions.current.clear();
        return () => animations.forEach(animation => animation.cancel());
    }, [selectedContainers, reducedMotion]);

    const toggleGraph = (metric: Metric) => {
        graphPositions.current = new Map(Array.from(graphRefs.current, ([key, element]) => [key, element.getBoundingClientRect()]));
        setExpandedGraphs(prev => {
            const next = new Set(prev);
            if (next.has(metric)) next.delete(metric);
            else next.add(metric);
            return next;
        });
    };

    useLayoutEffect(() => {
        const animations: Animation[] = [];
        if (!reducedMotion) graphRefs.current.forEach((element, metric) => {
            const previous = graphPositions.current.get(metric);
            if (!previous) return;
            const current = element.getBoundingClientRect();
            const x = previous.left - current.left;
            const y = previous.top - current.top;
            if (x || y) animations.push(element.animate([
                { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
            ], { duration: 350, easing: 'cubic-bezier(.22, 1, .36, 1)' }));
        });
        graphPositions.current.clear();
        return () => animations.forEach(animation => animation.cancel());
    }, [expandedGraphs, reducedMotion]);

    const charts = METRICS.map(({ metric, title, description }) => ({
        metric, title, description,
        series: visibleContainers.flatMap(container => {
            const keys: ChartSeries['key'][] = metric === 'network' ? ['rx', 'tx'] : metric === 'disk' ? ['read', 'write'] : [metric];
            return keys.map(key => ({
                id: container.id,
                name: `${container.displayName}${metric === 'network' || metric === 'disk' ? ` · ${key.toUpperCase()}` : ''}`,
                project: container.composeProject,
                color: container.color,
                key,
                samples: history[container.id] || [],
                selected: selectedContainers.has(container.id),
            }));
        }),
    }));
    const graphOrder = new Map(Array.from(expandedGraphs, (metric, index) => [metric, index]));
    const orderedCharts = [...charts].sort((a, b) =>
        (graphOrder.get(a.metric) ?? Number.MAX_SAFE_INTEGER) -
        (graphOrder.get(b.metric) ?? Number.MAX_SAFE_INTEGER));

    return (
        <div id="monitoring-page">
            <div className="monitoring-heading">
                <div><h2>Resource monitoring</h2><p>Live container activity · Last 2 minutes</p></div>
                {!isLoading && !isColimaStopped && runningContainers.length > 0 && !error && <span className="live-badge"><span />Live</span>}
            </div>
            {isColimaStopped ? <ColimaDown message="Colima runtime unexpectedly stopped" /> : isLoading ? <Spinner message="Loading containers..." /> : runningContainers.length === 0 ? (
                <div className="empty-state">No running containers to monitor</div>
            ) : (
                <>
                    {error && <div className="monitoring-error" role="alert">{error}</div>}
                    <div className="series-key" aria-label="Select containers to monitor">
                        {selectedCount > 0 && <button className="clear-selection" aria-label="Clear all container selections"
                            onClick={() => { captureChipPositions(); setSelectedContainers(new Set()); }}><FiX /></button>}
                        {orderedContainers.map(container => (
                            <button key={container.id} ref={element => { if (element) chipRefs.current.set(container.id, element); else chipRefs.current.delete(container.id); }}
                                className={`container-chip ${selectedContainers.has(container.id) ? 'selected' : ''}`}
                                style={{ '--container-color': container.color, '--container-glow': `${container.color}40` } as React.CSSProperties}
                                aria-pressed={selectedContainers.has(container.id)} onClick={() => toggleContainer(container.id)}>
                                <i className="chip-dot" /><span className="chip-label">{container.displayName}
                                    {container.composeProject && <small>{container.composeProject}</small>}</span>
                                {selectedContainers.has(container.id) && <FiX className="chip-dismiss" aria-hidden="true" />}
                            </button>
                        ))}
                    </div>
                    <div className="graphs-container">
                        {orderedCharts.map(({ metric, title, description, series }) => (
                            <section className={`graph-section ${expandedGraphs.has(metric) ? 'expanded' : ''}`} key={metric}
                                ref={element => { if (element) graphRefs.current.set(metric, element); else graphRefs.current.delete(metric); }}
                                onClick={() => toggleGraph(metric)}>
                                <div className="graph-heading">
                                    <button className="graph-toggle" aria-expanded={expandedGraphs.has(metric)}
                                        aria-label={`${expandedGraphs.has(metric) ? 'Collapse' : 'Expand'} ${title}`}>
                                        <span><h3>{title}</h3><p>{description}</p></span><FiChevronDown />
                                    </button>
                                    {(metric === 'network' || metric === 'disk') && <div className="network-key">
                                        <span><i />{metric === 'network' ? 'RX' : 'Read'}</span>
                                        <span><i className="dashed" />{metric === 'network' ? 'TX' : 'Write'}</span>
                                    </div>}
                                </div>
                                <ResourceChart metric={metric} series={series} range={displayedRange || initialRange.current} reducedMotion={reducedMotion} />
                            </section>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default Monitoring;
