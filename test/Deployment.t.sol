// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {LotAuction} from "../src/LotAuction.sol";

/// @dev Models the factory as constructor caller; no initialization or token transfers to the app.
contract DeploymentHarness {
    function deploy() external returns (LaunchToken token, LotAuction auction) {
        token = new LaunchToken{salt: bytes32(uint256(1))}();
        auction = new LotAuction{salt: bytes32(uint256(2))}(address(token));
    }
}

contract DeploymentTest is Test {
    function testFactoryDeploymentPreservesEntireSupplyAndFullyConfiguresApp() public {
        DeploymentHarness factory = new DeploymentHarness();
        (LaunchToken token, LotAuction auction) = factory.deploy();
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(factory)), 1e27);
        assertEq(token.balanceOf(address(auction)), 0);
        assertEq(address(auction.token()), address(token));
        assertEq(auction.lotCount(), 0);
        _checkRuntime(address(token));
        _checkRuntime(address(auction));
    }

    function testConstructorsRejectValue() public {
        LaunchToken token = new LaunchToken();
        bytes memory code = abi.encodePacked(type(LotAuction).creationCode, abi.encode(address(token)));
        vm.deal(address(this), 2);
        address deployed;
        assembly ("memory-safe") {
            deployed := create(1, add(code, 32), mload(code))
        }
        assertEq(deployed, address(0));
        code = type(LaunchToken).creationCode;
        assembly ("memory-safe") {
            deployed := create(1, add(code, 32), mload(code))
        }
        assertEq(deployed, address(0));
    }

    function _checkRuntime(address deployed) private view {
        bytes memory code = deployed.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
            } else {
                assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
            }
        }
    }
}
