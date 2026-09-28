// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/vendor/EthereumDIDRegistry.sol";

/// @dev Minimal actor used to give Foundry tests distinct msg.sender values
/// without depending on forge-std cheatcodes.
contract DIDActor {
    function setAttribute(
        EthereumDIDRegistry registry,
        address identity,
        bytes32 name,
        bytes calldata value,
        uint256 validity
    ) external {
        registry.setAttribute(identity, name, value, validity);
    }

    function changeOwner(
        EthereumDIDRegistry registry,
        address identity,
        address newOwner
    ) external {
        registry.changeOwner(identity, newOwner);
    }
}

contract EthereumDIDRegistryTest {
    EthereumDIDRegistry private registry;
    DIDActor private identity;
    DIDActor private newController;
    DIDActor private attacker;

    bytes32 private constant ED25519_ATTRIBUTE = bytes32("did/pub/Ed25519/veriKey/base64");

    function setUp() public {
        registry = new EthereumDIDRegistry();
        identity = new DIDActor();
        newController = new DIDActor();
        attacker = new DIDActor();
    }

    function testIdentityOwnsItselfByDefault() public view {
        require(
            registry.identityOwner(address(identity)) == address(identity),
            "fresh identity should control itself"
        );
    }

    function testOnlyCurrentControllerCanPublishDidAttributes() public {
        bytes memory publicKey = hex"01020304";

        identity.setAttribute(
            registry,
            address(identity),
            ED25519_ATTRIBUTE,
            publicKey,
            365 days
        );

        require(
            registry.changed(address(identity)) != 0,
            "authorized update should change DID history"
        );

        try attacker.setAttribute(
            registry,
            address(identity),
            ED25519_ATTRIBUTE,
            publicKey,
            365 days
        ) {
            revert("non-controller unexpectedly updated DID");
        } catch {
            // Expected: EthereumDIDRegistry rejects a non-owner with "bad_actor".
        }
    }

    function testControllerRotationTransfersUpdateAuthority() public {
        bytes memory publicKey = hex"01020304";

        identity.changeOwner(
            registry,
            address(identity),
            address(newController)
        );

        require(
            registry.identityOwner(address(identity)) == address(newController),
            "new controller not installed"
        );

        try identity.setAttribute(
            registry,
            address(identity),
            ED25519_ATTRIBUTE,
            publicKey,
            365 days
        ) {
            revert("old controller unexpectedly retained update authority");
        } catch {
            // Expected: old controller is no longer authorized.
        }

        newController.setAttribute(
            registry,
            address(identity),
            ED25519_ATTRIBUTE,
            publicKey,
            365 days
        );

        require(
            registry.changed(address(identity)) != 0,
            "new controller should be able to update DID"
        );
    }
}
