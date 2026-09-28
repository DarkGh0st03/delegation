// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEthereumDIDRegistry {
    function identityOwner(address identity) external view returns (address);
}

/// @title EnterpriseTrustRegistry
/// @notice Enterprise trust lifecycle for did:ethr identities.
/// @dev DID control remains in ERC-1056. This contract stores only enterprise
/// trust facts: enrollment, lifecycle status, trust-anchor role, and optional
/// sponsor provenance for dynamic agents.
contract EnterpriseTrustRegistry {
    enum IdentityStatus {
        Unregistered,
        Active,
        Suspended,
        Revoked
    }

    struct IdentityRecord {
        IdentityStatus status;
        bool trustAnchor;
        address sponsor;
        uint64 enrolledAt;
        uint64 updatedAt;
    }

    IEthereumDIDRegistry public immutable didRegistry;

    address public governance;
    address public pendingGovernance;

    mapping(address => IdentityRecord) private identities;
    mapping(address => address) public pendingSponsor;

    error ZeroAddress();
    error OnlyGovernance();
    error NotDidController(address identity, address expectedController, address caller);
    error AlreadyEnrolled(address identity);
    error NotEnrolled(address identity);
    error IdentityNotActive(address identity);
    error IdentityNotSuspended(address identity);
    error IdentityRevoked(address identity);
    error InvalidSponsor(address sponsor);
    error NoPendingSponsoredEnrollment(address identity);
    error SponsorMismatch(address expectedSponsor, address suppliedSponsor);
    error NotSponsoredAgent(address sponsor, address agent);
    error TrustAnchorRequiresActiveIdentity(address identity);
    error OnlyPendingGovernance();

    event GovernanceTransferStarted(
        address indexed currentGovernance,
        address indexed pendingGovernance
    );
    event GovernanceTransferred(
        address indexed previousGovernance,
        address indexed newGovernance
    );

    event IdentityEnrolled(
        address indexed identity,
        address indexed sponsor,
        bool sponsored
    );
    event SponsoredEnrollmentProposed(
        address indexed sponsor,
        address indexed agent
    );
    event SponsoredEnrollmentCancelled(
        address indexed sponsor,
        address indexed agent
    );
    event IdentityStatusChanged(
        address indexed identity,
        IdentityStatus previousStatus,
        IdentityStatus newStatus,
        address indexed actor
    );
    event TrustAnchorChanged(
        address indexed identity,
        bool enabled,
        address indexed actor
    );

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    modifier onlyDidController(address identity) {
        address owner = didRegistry.identityOwner(identity);
        if (owner != msg.sender) {
            revert NotDidController(identity, owner, msg.sender);
        }
        _;
    }

    constructor(address didRegistryAddress, address governanceAddress) {
        if (didRegistryAddress == address(0) || governanceAddress == address(0)) {
            revert ZeroAddress();
        }

        didRegistry = IEthereumDIDRegistry(didRegistryAddress);
        governance = governanceAddress;
    }

    // ---------------------------------------------------------------------
    // Governance lifecycle
    // ---------------------------------------------------------------------

    function beginGovernanceTransfer(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert ZeroAddress();

        pendingGovernance = newGovernance;
        emit GovernanceTransferStarted(governance, newGovernance);
    }

    function acceptGovernance() external {
        if (msg.sender != pendingGovernance) revert OnlyPendingGovernance();

        address previous = governance;
        governance = msg.sender;
        pendingGovernance = address(0);

        emit GovernanceTransferred(previous, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Strong enterprise enrollment
    // ---------------------------------------------------------------------

    function enrollEnterpriseIdentity(address identity) external onlyGovernance {
        _requireUnregistered(identity);
        _enroll(identity, address(0));
    }

    // ---------------------------------------------------------------------
    // Sponsored enrollment for dynamic agents
    // ---------------------------------------------------------------------

    function proposeSponsoredEnrollment(
        address sponsorIdentity,
        address agentIdentity
    ) external onlyDidController(sponsorIdentity) {
        if (sponsorIdentity == address(0) || agentIdentity == address(0)) {
            revert ZeroAddress();
        }
        if (sponsorIdentity == agentIdentity) {
            revert InvalidSponsor(sponsorIdentity);
        }

        _requireActive(sponsorIdentity);
        _requireUnregistered(agentIdentity);

        pendingSponsor[agentIdentity] = sponsorIdentity;
        emit SponsoredEnrollmentProposed(sponsorIdentity, agentIdentity);
    }

    function cancelSponsoredEnrollment(
        address sponsorIdentity,
        address agentIdentity
    ) external onlyDidController(sponsorIdentity) {
        address expectedSponsor = pendingSponsor[agentIdentity];
        if (expectedSponsor == address(0)) {
            revert NoPendingSponsoredEnrollment(agentIdentity);
        }
        if (expectedSponsor != sponsorIdentity) {
            revert SponsorMismatch(expectedSponsor, sponsorIdentity);
        }

        delete pendingSponsor[agentIdentity];
        emit SponsoredEnrollmentCancelled(sponsorIdentity, agentIdentity);
    }

    function acceptSponsoredEnrollment(
        address agentIdentity
    ) external onlyDidController(agentIdentity) {
        _requireUnregistered(agentIdentity);

        address sponsorIdentity = pendingSponsor[agentIdentity];
        if (sponsorIdentity == address(0)) {
            revert NoPendingSponsoredEnrollment(agentIdentity);
        }

        _requireActive(sponsorIdentity);

        delete pendingSponsor[agentIdentity];
        _enroll(agentIdentity, sponsorIdentity);
    }

    // ---------------------------------------------------------------------
    // Enterprise lifecycle controls
    // ---------------------------------------------------------------------

    function suspendIdentity(address identity) external onlyGovernance {
        _suspend(identity, msg.sender);
    }

    function reactivateIdentity(address identity) external onlyGovernance {
        IdentityRecord storage record = identities[identity];

        if (record.status == IdentityStatus.Revoked) {
            revert IdentityRevoked(identity);
        }
        if (record.status != IdentityStatus.Suspended) {
            revert IdentityNotSuspended(identity);
        }

        IdentityStatus previous = record.status;
        record.status = IdentityStatus.Active;
        record.updatedAt = uint64(block.timestamp);

        emit IdentityStatusChanged(
            identity,
            previous,
            IdentityStatus.Active,
            msg.sender
        );
    }

    function revokeIdentity(address identity) external onlyGovernance {
        _revoke(identity, msg.sender);
    }

    function setTrustAnchor(
        address identity,
        bool enabled
    ) external onlyGovernance {
        IdentityRecord storage record = identities[identity];

        if (record.status == IdentityStatus.Unregistered) {
            revert NotEnrolled(identity);
        }
        if (record.status == IdentityStatus.Revoked) {
            revert IdentityRevoked(identity);
        }
        if (enabled && record.status != IdentityStatus.Active) {
            revert TrustAnchorRequiresActiveIdentity(identity);
        }

        record.trustAnchor = enabled;
        record.updatedAt = uint64(block.timestamp);

        emit TrustAnchorChanged(identity, enabled, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Sponsor kill switch
    // ---------------------------------------------------------------------

    function suspendSponsoredAgent(
        address sponsorIdentity,
        address agentIdentity
    ) external onlyDidController(sponsorIdentity) {
        _requireActive(sponsorIdentity);
        _requireSponsoredBy(agentIdentity, sponsorIdentity);
        _suspend(agentIdentity, sponsorIdentity);
    }

    function revokeSponsoredAgent(
        address sponsorIdentity,
        address agentIdentity
    ) external onlyDidController(sponsorIdentity) {
        _requireActive(sponsorIdentity);
        _requireSponsoredBy(agentIdentity, sponsorIdentity);
        _revoke(agentIdentity, sponsorIdentity);
    }

    // ---------------------------------------------------------------------
    // Read API used by verifiers/adapters
    // ---------------------------------------------------------------------

    function getIdentity(
        address identity
    ) external view returns (IdentityRecord memory) {
        return identities[identity];
    }

    function isEnrolled(address identity) external view returns (bool) {
        return identities[identity].status != IdentityStatus.Unregistered;
    }

    function isActive(address identity) external view returns (bool) {
        return identities[identity].status == IdentityStatus.Active;
    }

    function isTrustAnchor(address identity) external view returns (bool) {
        IdentityRecord storage record = identities[identity];
        return
            record.status == IdentityStatus.Active &&
            record.trustAnchor;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _enroll(address identity, address sponsorIdentity) internal {
        if (identity == address(0)) revert ZeroAddress();

        uint64 nowTs = uint64(block.timestamp);
        identities[identity] = IdentityRecord({
            status: IdentityStatus.Active,
            trustAnchor: false,
            sponsor: sponsorIdentity,
            enrolledAt: nowTs,
            updatedAt: nowTs
        });

        emit IdentityEnrolled(
            identity,
            sponsorIdentity,
            sponsorIdentity != address(0)
        );
        emit IdentityStatusChanged(
            identity,
            IdentityStatus.Unregistered,
            IdentityStatus.Active,
            msg.sender
        );
    }

    function _suspend(address identity, address actor) internal {
        IdentityRecord storage record = identities[identity];

        if (record.status == IdentityStatus.Unregistered) {
            revert NotEnrolled(identity);
        }
        if (record.status == IdentityStatus.Revoked) {
            revert IdentityRevoked(identity);
        }
        if (record.status != IdentityStatus.Active) {
            revert IdentityNotActive(identity);
        }

        IdentityStatus previous = record.status;
        record.status = IdentityStatus.Suspended;
        record.updatedAt = uint64(block.timestamp);

        emit IdentityStatusChanged(
            identity,
            previous,
            IdentityStatus.Suspended,
            actor
        );
    }

    function _revoke(address identity, address actor) internal {
        IdentityRecord storage record = identities[identity];

        if (record.status == IdentityStatus.Unregistered) {
            revert NotEnrolled(identity);
        }
        if (record.status == IdentityStatus.Revoked) {
            revert IdentityRevoked(identity);
        }

        IdentityStatus previous = record.status;
        record.status = IdentityStatus.Revoked;
        record.trustAnchor = false;
        record.updatedAt = uint64(block.timestamp);

        emit IdentityStatusChanged(
            identity,
            previous,
            IdentityStatus.Revoked,
            actor
        );
    }

    function _requireUnregistered(address identity) internal view {
        if (identity == address(0)) revert ZeroAddress();
        if (identities[identity].status != IdentityStatus.Unregistered) {
            revert AlreadyEnrolled(identity);
        }
    }

    function _requireActive(address identity) internal view {
        IdentityStatus status = identities[identity].status;

        if (status == IdentityStatus.Unregistered) {
            revert NotEnrolled(identity);
        }
        if (status == IdentityStatus.Revoked) {
            revert IdentityRevoked(identity);
        }
        if (status != IdentityStatus.Active) {
            revert IdentityNotActive(identity);
        }
    }

    function _requireSponsoredBy(
        address agentIdentity,
        address sponsorIdentity
    ) internal view {
        if (identities[agentIdentity].sponsor != sponsorIdentity) {
            revert NotSponsoredAgent(sponsorIdentity, agentIdentity);
        }
    }
}
