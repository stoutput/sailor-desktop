import React from 'react';
import { FiLoader } from 'react-icons/fi';
import "./spinner.scss";

interface SpinnerProps {
    message?: string;
}

const Spinner = ({ message = 'Loading...' }: SpinnerProps) => {
    return (
        <div className="loading-state">
            <FiLoader className="spinner-icon" />
            <p>{message}</p>
        </div>
    );
};

export default Spinner;
