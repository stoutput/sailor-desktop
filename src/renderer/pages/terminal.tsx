import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FiBox } from 'react-icons/fi';
import { ContainerData } from '@common/types';
import { useContainers } from '@renderer/hooks/useContainers';
import Spinner from '@components/spinner';
import ColimaDown from '@components/colimadown';
import "./terminal.scss";

// Simple fuzzy search implementation
const fuzzyMatch = (pattern: string, str: string): boolean => {
    if (!pattern) return true;
    pattern = pattern.toLowerCase();
    str = str.toLowerCase();

    let patternIdx = 0;
    for (let i = 0; i < str.length && patternIdx < pattern.length; i++) {
        if (str[i] === pattern[patternIdx]) {
            patternIdx++;
        }
    }
    return patternIdx === pattern.length;
};

const Terminal = () => {
    const { isLoading, isColimaStopped, runningContainers } = useContainers();
    const [selectedContainer, setSelectedContainer] = useState<ContainerData | null>(null);
    const [terminalOutput, setTerminalOutput] = useState<string>('');
    const [inputBuffer, setInputBuffer] = useState<string>('');
    const [isConnected, setIsConnected] = useState(false);
    const [showContainerPanel, setShowContainerPanel] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Command history state
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const [historySearchBase, setHistorySearchBase] = useState<string>('');

    const terminalRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll terminal to bottom
    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [terminalOutput]);

    // Listen for shell data and exit
    useEffect(() => {
        const removeDataListener = window.api.onShellData((_event, containerId, data) => {
            if (selectedContainer && containerId === selectedContainer.id) {
                setTerminalOutput(prev => prev + data);
            }
        });

        const removeExitListener = window.api.onShellExit((_event, containerId, code) => {
            if (selectedContainer && containerId === selectedContainer.id) {
                setTerminalOutput(prev => prev + `\r\n[Shell exited with code ${code}]\r\n`);
                setIsConnected(false);
            }
        });

        return () => {
            removeDataListener?.();
            removeExitListener?.();
        };
    }, [selectedContainer]);

    // Cleanup shell session on unmount
    useEffect(() => {
        return () => {
            if (selectedContainer) {
                window.api.closeShellSession(selectedContainer.id);
            }
        };
    }, []);

    const connectToContainer = useCallback(async (container: ContainerData) => {
        // Close existing session if any
        if (selectedContainer) {
            await window.api.closeShellSession(selectedContainer.id);
        }

        setSelectedContainer(container);
        setTerminalOutput(`Connecting to ${container.name}...\r\n`);
        setIsConnected(false);
        setShowContainerPanel(false);

        try {
            await window.api.createShellSession(container.id);
            setIsConnected(true);
            setTerminalOutput(prev => prev + `Connected to ${container.name}\r\n\r\n`);

            // Focus the input
            setTimeout(() => inputRef.current?.focus(), 100);
        } catch (err) {
            setTerminalOutput(prev => prev + `Failed to connect: ${err}\r\n`);
        }
    }, [selectedContainer]);

    // Get filtered history based on current search base (most recent first)
    const getFilteredHistory = useCallback((searchBase: string): string[] => {
        const reversed = [...commandHistory].reverse(); // Most recent first
        if (!searchBase) return reversed;
        return reversed.filter(cmd =>
            cmd.toLowerCase().startsWith(searchBase.toLowerCase())
        );
    }, [commandHistory]);

    // Find tab completion matches (most recent first)
    const getTabCompletions = useCallback((prefix: string): string[] => {
        if (!prefix) return [];
        const reversed = [...commandHistory].reverse(); // Most recent first
        const matches = reversed.filter(cmd =>
            cmd.toLowerCase().startsWith(prefix.toLowerCase()) && cmd !== prefix
        );
        // Return unique matches (keeping most recent order)
        return [...new Set(matches)];
    }, [commandHistory]);

    // Get the current auto-completion suggestion (most recent match)
    const autoCompleteSuggestion = React.useMemo(() => {
        if (!inputBuffer || historyIndex !== -1) return '';
        const completions = getTabCompletions(inputBuffer);
        if (completions.length > 0) {
            // Return only the part after what's already typed (first = most recent)
            return completions[0].slice(inputBuffer.length);
        }
        return '';
    }, [inputBuffer, historyIndex, getTabCompletions]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isConnected || !selectedContainer) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            const command = inputBuffer.trim();
            if (command) {
                // Add to history (avoid duplicates at the end)
                setCommandHistory(prev => {
                    const newHistory = prev.filter(cmd => cmd !== command);
                    return [...newHistory, command];
                });
            }
            window.api.writeToShell(selectedContainer.id, inputBuffer + '\n');
            setInputBuffer('');
            setHistoryIndex(-1);
            setHistorySearchBase('');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const searchBase = historyIndex === -1 ? inputBuffer : historySearchBase;
            const filtered = getFilteredHistory(searchBase); // Most recent first

            if (filtered.length === 0) return;

            if (historyIndex === -1) {
                // Starting to navigate history - start at most recent (index 0)
                setHistorySearchBase(inputBuffer);
                setHistoryIndex(0);
                setInputBuffer(filtered[0]);
            } else if (historyIndex < filtered.length - 1) {
                // Go to older command (higher index = older)
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setInputBuffer(filtered[newIndex]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex === -1) return;

            const filtered = getFilteredHistory(historySearchBase);

            if (historyIndex > 0) {
                // Go to more recent command (lower index = more recent)
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setInputBuffer(filtered[newIndex]);
            } else {
                // Back to the original input
                setHistoryIndex(-1);
                setInputBuffer(historySearchBase);
            }
        } else if (e.key === 'Tab') {
            e.preventDefault();
            // If there's a visible suggestion, accept it
            if (autoCompleteSuggestion) {
                setInputBuffer(inputBuffer + autoCompleteSuggestion);
            } else {
                const completions = getTabCompletions(inputBuffer);
                if (completions.length > 1) {
                    // Multiple matches - show available completions in output
                    setTerminalOutput(prev =>
                        prev + '\r\n' + completions.join('  ') + '\r\n'
                    );
                }
            }
        } else if (e.key === 'ArrowRight' && autoCompleteSuggestion) {
            // Right arrow at end of input accepts suggestion
            const input = inputRef.current;
            if (input && input.selectionStart === inputBuffer.length) {
                e.preventDefault();
                setInputBuffer(inputBuffer + autoCompleteSuggestion);
            }
        } else if (e.key === 'c' && e.ctrlKey) {
            e.preventDefault();
            window.api.writeToShell(selectedContainer.id, '\x03'); // Ctrl+C
            setHistoryIndex(-1);
            setHistorySearchBase('');
        } else if (e.key === 'd' && e.ctrlKey) {
            e.preventDefault();
            window.api.writeToShell(selectedContainer.id, '\x04'); // Ctrl+D (EOF)
        } else {
            // Reset history navigation when typing
            if (historyIndex !== -1 && e.key.length === 1) {
                setHistoryIndex(-1);
                setHistorySearchBase('');
            }
        }
    }, [isConnected, selectedContainer, inputBuffer, commandHistory, historyIndex, historySearchBase, getFilteredHistory, getTabCompletions]);

    const handleTerminalClick = () => {
        inputRef.current?.focus();
    };

    const filteredContainers = runningContainers.filter(c =>
        fuzzyMatch(searchQuery, c.name) || fuzzyMatch(searchQuery, c.image)
    );

    return (
        <div id="terminal-page">
            <div
                className={`terminal-container ${isConnected ? 'connected' : ''}`}
                onClick={handleTerminalClick}
            >
                {!selectedContainer ? (
                    <div className="terminal-placeholder">
                        <p>Select a container to start a shell session</p>
                        <button
                            className="select-container-btn"
                            onClick={(e) => { e.stopPropagation(); setShowContainerPanel(true); }}
                        >
                            Select Container
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="terminal-output monospace" ref={terminalRef}>
                            <pre>{terminalOutput}</pre>
                        </div>
                        {isConnected && (
                            <div className="terminal-input-line monospace">
                                <span className="prompt">$</span>
                                <div className="input-wrapper">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={inputBuffer}
                                        onChange={(e) => setInputBuffer(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        className="terminal-input"
                                        autoFocus
                                        spellCheck={false}
                                        autoComplete="off"
                                    />
                                    {autoCompleteSuggestion && (
                                        <span className="autocomplete-suggestion">
                                            <span className="typed-mirror">{inputBuffer}</span>
                                            <span className="suggestion-text">{autoCompleteSuggestion}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        {!isConnected && selectedContainer && (
                            <div className="reconnect-prompt">
                                <button onClick={() => connectToContainer(selectedContainer)}>
                                    Reconnect
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Container selector button */}
            <button
                className={`container-selector-btn ${showContainerPanel ? 'active' : ''}`}
                onClick={() => setShowContainerPanel(!showContainerPanel)}
                title="Select container"
            >
                <FiBox size={20} />
            </button>

            {/* Container panel */}
            <div className={`container-panel ${showContainerPanel ? 'open' : ''}`}>
                <div className="panel-header">
                    <h3>Running Containers</h3>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search containers..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus={showContainerPanel}
                    />
                </div>
                <div className="container-list">
                    {isColimaStopped ? (
                        <ColimaDown message="Colima runtime stopped" />
                    ) : isLoading ? (
                        <Spinner message="Loading containers..." />
                    ) : filteredContainers.length === 0 ? (
                        <div className="no-containers">
                            {runningContainers.length === 0
                                ? 'No running containers'
                                : 'No containers match your search'
                            }
                        </div>
                    ) : (
                        filteredContainers.map(container => (
                            <div
                                key={container.id}
                                className={`container-item ${selectedContainer?.id === container.id ? 'selected' : ''}`}
                                onClick={() => connectToContainer(container)}
                            >
                                <div className="status-indicator running" />
                                <div className="container-details">
                                    <div className="container-name">{container.name}</div>
                                    <div className="container-image">{container.image}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Overlay to close panel when clicking outside */}
            {showContainerPanel && (
                <div className="panel-overlay" onClick={() => setShowContainerPanel(false)} />
            )}
        </div>
    );
};

export default Terminal;
