// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/vendor/EthereumDIDRegistry.sol";
import "../src/EnterpriseTrustRegistry.sol";

contract TrustActor {
    function proposeSponsoredEnrollment(
        EnterpriseTrustRegistry trust,
        address sponsorIdentity,
        address agentIdentity
    ) external {
        trust.proposeSponsoredEnrollment(sponsorIdentity, agentIdentity);
    }

    function acceptSponsoredEnrollment(
        EnterpriseTrustRegistry trust,
        address agentIdentity
    ) external {
        trust.acceptSponsoredEnrollment(agentIdentity);
    }

    function suspendSponsoredAgent(
        EnterpriseTrustRegistry trust,
        address sponsorIdentity,
        address agentIdentity
    ) external {
        trust.suspendSponsoredAgent(sponsorIdentity, agentIdentity);
    }

    function revokeSponsoredAgent(
        EnterpriseTrustRegistry trust,
        address sponsorIdentity,
        address agentIdentity
    ) external {
        trust.revokeSponsoredAgent(sponsorIdentity, agentIdentity);
    }

    function enrollEnterpriseIdentity(
        EnterpriseTrustRegistry trust,
        address identity
    ) external {
        trust.enrollEnterpriseIdentity(identity);
    }

    function setTrustAnchor(
        EnterpriseTrustRegistry trust,
        address identity,
        bool enabled
    ) external {
        trust.setTrustAnchor(identity, enabled);
    }

    function changeDidOwner(
        EthereumDIDRegistry didRegistry,
        address identity,
        address newOwner
    ) external {
        didRegistry.changeOwner(identity, newOwner);
    }
}

contract EnterpriseTrustRegistryTest {
    EthereumDIDRegistry private didRegistry;
    EnterpriseTrustRegistry private trust;

    TrustActor private sponsor;
    TrustActor private agent;
    TrustActor private attacker;
    TrustActor private newSponsorController;

    function setUp() public {
        didRegistry = new EthereumDIDRegistry();
        trust = new EnterpriseTrustRegistry(
            address(didRegistry),
            address(this)
        );

        sponsor = new TrustActor();
        agent = new TrustActor();
        attacker = new TrustActor();
        newSponsorController = new TrustActor();
    }

    function testUnregisteredIdentityFailsClosed() public view {
        require(!trust.isEnrolled(address(agent)), "unexpected enrollment");
        require(!trust.isActive(address(agent)), "unexpected active state");
        require(!trust.isTrustAnchor(address(agent)), "unexpected trust anchor");
    }

    function testGovernanceCanEnrollAndAssignTrustAnchor() public {
        trust.enrollEnterpriseIdentity(address(sponsor));

        require(trust.isEnrolled(address(sponsor)), "not enrolled");
        require(trust.isActive(address(sponsor)), "not active");

        trust.setTrustAnchor(address(sponsor), true);

        require(
            trust.isTrustAnchor(address(sponsor)),
            "trust anchor not effective"
        );
    }

    function testNonGovernanceCannotEnrollOrAssignTrustAnchor() public {
        try attacker.enrollEnterpriseIdentity(trust, address(agent)) {
            revert("non-governance enrolled identity");
        } catch {}

        trust.enrollEnterpriseIdentity(address(agent));

        try attacker.setTrustAnchor(trust, address(agent), true) {
            revert("non-governance assigned trust anchor");
        } catch {}
    }

    function testSponsoredEnrollmentRequiresAgentControllerAcceptance() public {
        trust.enrollEnterpriseIdentity(address(sponsor));

        sponsor.proposeSponsoredEnrollment(
            trust,
            address(sponsor),
            address(agent)
        );

        require(
            !trust.isEnrolled(address(agent)),
            "proposal should not enroll agent"
        );

        try attacker.acceptSponsoredEnrollment(trust, address(agent)) {
            revert("non-controller accepted agent enrollment");
        } catch {}

        agent.acceptSponsoredEnrollment(trust, address(agent));

        EnterpriseTrustRegistry.IdentityRecord memory record =
            trust.getIdentity(address(agent));

        require(record.status == EnterpriseTrustRegistry.IdentityStatus.Active);
        require(record.sponsor == address(sponsor), "wrong sponsor");
        require(!record.trustAnchor, "sponsored agent became trust anchor");
    }

    function testSponsorCanSuspendAndGovernanceCanReactivateAgent() public {
        _enrollSponsoredAgent();

        sponsor.suspendSponsoredAgent(
            trust,
            address(sponsor),
            address(agent)
        );

        require(!trust.isActive(address(agent)), "agent still active");

        trust.reactivateIdentity(address(agent));

        require(trust.isActive(address(agent)), "agent not reactivated");
    }

    function testRevocationIsTerminalAndClearsTrustAnchor() public {
        trust.enrollEnterpriseIdentity(address(sponsor));
        trust.setTrustAnchor(address(sponsor), true);

        trust.revokeIdentity(address(sponsor));

        require(!trust.isActive(address(sponsor)), "revoked identity active");
        require(
            !trust.isTrustAnchor(address(sponsor)),
            "revoked identity still trusted as anchor"
        );

        try trust.reactivateIdentity(address(sponsor)) {
            revert("revoked identity was reactivated");
        } catch {}
    }

    function testRotatedDidControllerCanActForSponsorIdentity() public {
        trust.enrollEnterpriseIdentity(address(sponsor));

        sponsor.changeDidOwner(
            didRegistry,
            address(sponsor),
            address(newSponsorController)
        );

        try sponsor.proposeSponsoredEnrollment(
            trust,
            address(sponsor),
            address(agent)
        ) {
            revert("old DID controller retained authority");
        } catch {}

        newSponsorController.proposeSponsoredEnrollment(
            trust,
            address(sponsor),
            address(agent)
        );

        require(
            trust.pendingSponsor(address(agent)) == address(sponsor),
            "new controller could not sponsor agent"
        );
    }

    function testSponsoredAgentCanBeRevokedBySponsor() public {
        _enrollSponsoredAgent();

        sponsor.revokeSponsoredAgent(
            trust,
            address(sponsor),
            address(agent)
        );

        EnterpriseTrustRegistry.IdentityRecord memory record =
            trust.getIdentity(address(agent));

        require(record.status == EnterpriseTrustRegistry.IdentityStatus.Revoked);

        try trust.reactivateIdentity(address(agent)) {
            revert("sponsor-revoked agent was reactivated");
        } catch {}
    }

    function _enrollSponsoredAgent() internal {
        trust.enrollEnterpriseIdentity(address(sponsor));

        sponsor.proposeSponsoredEnrollment(
            trust,
            address(sponsor),
            address(agent)
        );

        agent.acceptSponsoredEnrollment(trust, address(agent));
    }
}
