import React from 'react';
import anchorSvg from '@assets/icons/anchor.svg';
import './anchoricon.scss';

interface AnchorIconProps {
    className?: string;
    size?: number;
}

const AnchorIcon: React.FC<AnchorIconProps> = ({ className = '', size = 48 }) => {
    return (
        <img
            src={anchorSvg}
            alt="Anchor"
            className={`anchor-icon ${className}`}
            style={{ width: size, height: size }}
        />
    );
};

export default AnchorIcon;
