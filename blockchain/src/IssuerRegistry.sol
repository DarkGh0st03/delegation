// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIssuerDidRegistry {
    function identityOwner(address identity) external view returns (address);
}

interface IEnterpriseTrustRegistryView {
    function isActive(address identity) external view returns (bool);
}

/// @title IssuerRegistry
/// @notice Anchors issuer public material without storing delegation credentials.
/// @dev Accumulator material is versioned historically because credentials must
/// keep verifying against the exact public material used at issuance.
/// Status Lists expose only the current anchored document hash because
/// revocation/suspension checks must use the latest list state.
contract IssuerRegistry {
    enum StatusPurpose {
        None,
        Revocation,
        Suspension
    }

    struct AccumulatorMaterial {
        bytes32 materialHash;
        uint64 publishedAt;
        bool exists;
    }

    struct StatusListAnchor {
        StatusPurpose purpose;
        bytes32 currentDocumentHash;
        uint64 currentVersion;
        uint64 updatedAt;
        bool exists;
    }

    IIssuerDidRegistry public immutable didRegistry;
    IEnterpriseTrustRegistryView public immutable trustRegistry;

    mapping(address => uint64) public latestAccumulatorMaterialVersion;
    mapping(address => mapping(uint64 => AccumulatorMaterial))
        private accumulatorMaterials;

    mapping(address => mapping(bytes32 => StatusListAnchor))
        private statusLists;

    error ZeroAddress();
    error IssuerNotActive(address issuer);
    error NotDidController(
        address issuer,
        address expectedController,
        address caller
    );
    error ZeroHash();
    error InvalidStatusListId();
    error InvalidStatusPurpose();
    error StatusListAlreadyRegistered(address issuer, bytes32 listId);
    error StatusListNotRegistered(address issuer, bytes32 listId);
    error DocumentHashUnchanged(address issuer, bytes32 listId);

    event AccumulatorMaterialPublished(
        address indexed issuer,
        uint64 indexed version,
        bytes32 indexed materialHash
    );

    event StatusListRegistered(
        address indexed issuer,
        bytes32 indexed listId,
        StatusPurpose purpose,
        uint64 version,
        bytes32 documentHash
    );

    event StatusListUpdated(
        address indexed issuer,
        bytes32 indexed listId,
        uint64 version,
        bytes32 documentHash
    );

    modifier onlyActiveIssuerController(address issuer) {
        if (!trustRegistry.isActive(issuer)) {
            revert IssuerNotActive(issuer);
        }

        address owner = didRegistry.identityOwner(issuer);
        if (owner != msg.sender) {
            revert NotDidController(issuer, owner, msg.sender);
        }

        _;
    }

    constructor(address didRegistryAddress, address trustRegistryAddress) {
        if (
            didRegistryAddress == address(0) ||
            trustRegistryAddress == address(0)
        ) {
            revert ZeroAddress();
        }

        didRegistry = IIssuerDidRegistry(didRegistryAddress);
        trustRegistry = IEnterpriseTrustRegistryView(trustRegistryAddress);
    }

    // ---------------------------------------------------------------------
    // Historical accumulator public material
    // ---------------------------------------------------------------------

    function publishAccumulatorMaterial(
        address issuer,
        bytes32 materialHash
    )
        external
        onlyActiveIssuerController(issuer)
        returns (uint64 version)
    {
        if (materialHash == bytes32(0)) revert ZeroHash();

        version = latestAccumulatorMaterialVersion[issuer] + 1;
        latestAccumulatorMaterialVersion[issuer] = version;

        accumulatorMaterials[issuer][version] = AccumulatorMaterial({
            materialHash: materialHash,
            publishedAt: uint64(block.timestamp),
            exists: true
        });

        emit AccumulatorMaterialPublished(issuer, version, materialHash);
    }

    function getAccumulatorMaterial(
        address issuer,
        uint64 version
    ) external view returns (AccumulatorMaterial memory) {
        return accumulatorMaterials[issuer][version];
    }

    // ---------------------------------------------------------------------
    // Current Bitstring Status List anchors
    // ---------------------------------------------------------------------

    function registerStatusList(
        address issuer,
        bytes32 listId,
        StatusPurpose purpose,
        bytes32 documentHash
    ) external onlyActiveIssuerController(issuer) {
        if (listId == bytes32(0)) revert InvalidStatusListId();
        if (purpose == StatusPurpose.None) revert InvalidStatusPurpose();
        if (documentHash == bytes32(0)) revert ZeroHash();

        StatusListAnchor storage anchor = statusLists[issuer][listId];
        if (anchor.exists) {
            revert StatusListAlreadyRegistered(issuer, listId);
        }

        anchor.purpose = purpose;
        anchor.currentDocumentHash = documentHash;
        anchor.currentVersion = 1;
        anchor.updatedAt = uint64(block.timestamp);
        anchor.exists = true;

        emit StatusListRegistered(
            issuer,
            listId,
            purpose,
            1,
            documentHash
        );
    }

    function updateStatusList(
        address issuer,
        bytes32 listId,
        bytes32 documentHash
    ) external onlyActiveIssuerController(issuer) returns (uint64 version) {
        if (documentHash == bytes32(0)) revert ZeroHash();

        StatusListAnchor storage anchor = statusLists[issuer][listId];
        if (!anchor.exists) {
            revert StatusListNotRegistered(issuer, listId);
        }
        if (anchor.currentDocumentHash == documentHash) {
            revert DocumentHashUnchanged(issuer, listId);
        }

        version = anchor.currentVersion + 1;
        anchor.currentVersion = version;
        anchor.currentDocumentHash = documentHash;
        anchor.updatedAt = uint64(block.timestamp);

        emit StatusListUpdated(issuer, listId, version, documentHash);
    }

    function getStatusList(
        address issuer,
        bytes32 listId
    ) external view returns (StatusListAnchor memory) {
        return statusLists[issuer][listId];
    }

    function isStatusListRegistered(
        address issuer,
        bytes32 listId
    ) external view returns (bool) {
        return statusLists[issuer][listId].exists;
    }
}
