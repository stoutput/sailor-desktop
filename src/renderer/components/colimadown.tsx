import React, { useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';

import "./colimadown.scss";

interface ColimaDownProps {
    message?: string;
}

const ColimaDown = ({ message = 'Colima runtime is not running' }: ColimaDownProps) => {
    const [isRestarting, setIsRestarting] = useState(false);

    const handleRestart = async () => {
        setIsRestarting(true);
        try {
            await window.api.restartColima();
        } catch (err) {
            console.error('Failed to restart colima:', err);
            setIsRestarting(false);
        }
    };

    return (
        <div className="colima-down">
            <div className="colima-down-icon">
                <FiRefreshCw className={isRestarting ? 'spinning' : ''} />
            </div>
            <p className="colima-down-message">{message}</p>
            <button
                className="restart-btn"
                onClick={handleRestart}
                disabled={isRestarting}
            >
                {isRestarting ? 'Restarting...' : 'Restart Colima'}
            </button>
        </div>
    );
};

export default ColimaDown;
