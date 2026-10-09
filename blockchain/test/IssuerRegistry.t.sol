// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/vendor/EthereumDIDRegistry.sol";
import "../src/EnterpriseTrustRegistry.sol";
import "../src/IssuerRegistry.sol";

contract IssuerActor {
    function publishAccumulatorMaterial(
        IssuerRegistry registry,
        address issuer,
        bytes32 materialHash
    ) external returns (uint64) {
        return registry.publishAccumulatorMaterial(issuer, materialHash);
    }

    function registerStatusList(
        IssuerRegistry registry,
        address issuer,
        bytes32 listId,
        IssuerRegistry.StatusPurpose purpose,
        bytes32 artifactHash
    ) external {
        registry.registerStatusList(
            issuer,
            listId,
            purpose,
            artifactHash
        );
    }

    function updateStatusList(
        IssuerRegistry registry,
        address issuer,
        bytes32 listId,
        bytes32 artifactHash
    ) external returns (uint64) {
        return registry.updateStatusList(issuer, listId, artifactHash);
    }

    function changeDidOwner(
        EthereumDIDRegistry didRegistry,
        address identity,
        address newOwner
    ) external {
        didRegistry.changeOwner(identity, newOwner);
    }

    function proposeSponsoredEnrollment(
        EnterpriseTrustRegistry trustRegistry,
        address sponsor,
        address agent
    ) external {
        trustRegistry.proposeSponsoredEnrollment(sponsor, agent);
    }

    function acceptSponsoredEnrollment(
        EnterpriseTrustRegistry trustRegistry,
        address agent
    ) external {
        trustRegistry.acceptSponsoredEnrollment(agent);
    }
}

contract IssuerRegistryTest {
    EthereumDIDRegistry private didRegistry;
    EnterpriseTrustRegistry private trustRegistry;
    IssuerRegistry private issuerRegistry;

    IssuerActor private issuer;
    IssuerActor private rotatedController;
    IssuerActor private sponsor;
    IssuerActor private agent;

    bytes32 private constant MATERIAL_V1 = keccak256("material-v1");
    bytes32 private constant MATERIAL_V2 = keccak256("material-v2");
    bytes32 private constant LIST_ID = keccak256("status-list-1");
    bytes32 private constant LIST_ARTIFACT_HASH_V1 = keccak256("status-list-artifact-v1");
    bytes32 private constant LIST_ARTIFACT_HASH_V2 = keccak256("status-list-artifact-v2");

    function setUp() public {
        didRegistry = new EthereumDIDRegistry();
        trustRegistry = new EnterpriseTrustRegistry(
            address(didRegistry),
            address(this)
        );
        issuerRegistry = new IssuerRegistry(
            address(didRegistry),
            address(trustRegistry)
        );

        issuer = new IssuerActor();
        rotatedController = new IssuerActor();
        sponsor = new IssuerActor();
        agent = new IssuerActor();
    }

    function testAccumulatorMaterialKeepsHistoricalVersions() public {
        trustRegistry.enrollEnterpriseIdentity(address(issuer));

        uint64 v1 = issuer.publishAccumulatorMaterial(
            issuerRegistry,
            address(issuer),
            MATERIAL_V1
        );
        uint64 v2 = issuer.publishAccumulatorMaterial(
            issuerRegistry,
            address(issuer),
            MATERIAL_V2
        );

        require(v1 == 1, "unexpected first version");
        require(v2 == 2, "unexpected second version");
        require(
            issuerRegistry.latestAccumulatorMaterialVersion(address(issuer)) == 2,
            "latest version mismatch"
        );

        IssuerRegistry.AccumulatorMaterial memory oldMaterial =
            issuerRegistry.getAccumulatorMaterial(address(issuer), 1);
        IssuerRegistry.AccumulatorMaterial memory currentMaterial =
            issuerRegistry.getAccumulatorMaterial(address(issuer), 2);

        require(oldMaterial.exists, "version 1 missing");
        require(oldMaterial.materialHash == MATERIAL_V1, "version 1 changed");
        require(currentMaterial.exists, "version 2 missing");
        require(
            currentMaterial.materialHash == MATERIAL_V2,
            "version 2 mismatch"
        );
    }

    function testInactiveIssuerCannotPublishMaterial() public {
        try issuer.publishAccumulatorMaterial(
            issuerRegistry,
            address(issuer),
            MATERIAL_V1
        ) {
            revert("unregistered issuer published material");
        } catch {}

        trustRegistry.enrollEnterpriseIdentity(address(issuer));
        trustRegistry.suspendIdentity(address(issuer));

        try issuer.publishAccumulatorMaterial(
            issuerRegistry,
            address(issuer),
            MATERIAL_V1
        ) {
            revert("suspended issuer published material");
        } catch {}
    }

    function testDidControllerRotationTransfersPublishingAuthority() public {
        trustRegistry.enrollEnterpriseIdentity(address(issuer));

        issuer.changeDidOwner(
            didRegistry,
            address(issuer),
            address(rotatedController)
        );

        try issuer.publishAccumulatorMaterial(
            issuerRegistry,
            address(issuer),
            MATERIAL_V1
        ) {
            revert("old DID controller retained publishing authority");
        } catch {}

        uint64 version = rotatedController.publishAccumulatorMaterial(
            issuerRegistry,
            address(issuer),
            MATERIAL_V1
        );

        require(version == 1, "new controller could not publish");
    }

    function testStatusListUsesCurrentVersionWhilePurposeStaysStable() public {
        trustRegistry.enrollEnterpriseIdentity(address(issuer));

        issuer.registerStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            IssuerRegistry.StatusPurpose.Revocation,
            LIST_ARTIFACT_HASH_V1
        );

        uint64 version = issuer.updateStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            LIST_ARTIFACT_HASH_V2
        );

        require(version == 2, "status list version not advanced");

        IssuerRegistry.StatusListAnchor memory anchor =
            issuerRegistry.getStatusList(address(issuer), LIST_ID);

        require(anchor.exists, "status list missing");
        require(
            anchor.purpose == IssuerRegistry.StatusPurpose.Revocation,
            "purpose changed"
        );
        require(anchor.currentVersion == 2, "wrong current version");
        require(
            anchor.currentArtifactHash == LIST_ARTIFACT_HASH_V2,
            "wrong current artifact"
        );
    }

    function testStatusListCannotBeDuplicatedOrUpdatedWithSameHash() public {
        trustRegistry.enrollEnterpriseIdentity(address(issuer));

        issuer.registerStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            IssuerRegistry.StatusPurpose.Suspension,
            LIST_ARTIFACT_HASH_V1
        );

        try issuer.registerStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            IssuerRegistry.StatusPurpose.Suspension,
            LIST_ARTIFACT_HASH_V1
        ) {
            revert("duplicate status list registration succeeded");
        } catch {}

        try issuer.updateStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            LIST_ARTIFACT_HASH_V1
        ) {
            revert("unchanged status artifact created a new version");
        } catch {}
    }

    function testSuspendedIssuerCannotUpdateStatusList() public {
        trustRegistry.enrollEnterpriseIdentity(address(issuer));

        issuer.registerStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            IssuerRegistry.StatusPurpose.Revocation,
            LIST_ARTIFACT_HASH_V1
        );

        trustRegistry.suspendIdentity(address(issuer));

        try issuer.updateStatusList(
            issuerRegistry,
            address(issuer),
            LIST_ID,
            LIST_ARTIFACT_HASH_V2
        ) {
            revert("suspended issuer updated status list");
        } catch {}
    }

    function testSponsoredActiveAgentCanPublishIssuerMaterial() public {
        trustRegistry.enrollEnterpriseIdentity(address(sponsor));

        sponsor.proposeSponsoredEnrollment(
            trustRegistry,
            address(sponsor),
            address(agent)
        );
        agent.acceptSponsoredEnrollment(trustRegistry, address(agent));

        uint64 version = agent.publishAccumulatorMaterial(
            issuerRegistry,
            address(agent),
            MATERIAL_V1
        );

        require(version == 1, "active sponsored agent could not publish");
    }
}
