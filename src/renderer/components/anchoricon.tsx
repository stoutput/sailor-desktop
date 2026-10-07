import React from 'react';
import { MdAnchor } from 'react-icons/md';
import './anchoricon.scss';

interface AnchorIconProps {
    className?: string;
    size?: number;
}

const AnchorIcon: React.FC<AnchorIconProps> = ({ className = '', size = 48 }) => {
    return (
        <MdAnchor
            className={`anchor-icon ${className}`}
            size={size}
            title="Anchor"
        />
    );
};

export default AnchorIcon;
