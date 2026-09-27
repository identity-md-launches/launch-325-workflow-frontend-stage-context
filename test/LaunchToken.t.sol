// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract LaunchTokenTest is Test {
    LaunchToken internal token;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        token = new LaunchToken();
    }

    function testFixedSupplyAndMetadata() public view {
        assertEq(token.name(), "Gavel");
        assertEq(token.symbol(), "GAVL");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
    }

    function testTransferAndAllowance() public {
        assertTrue(token.transfer(ALICE, 12 ether));
        assertEq(token.balanceOf(address(this)), 1e27 - 12 ether);
        vm.prank(ALICE);
        token.approve(BOB, 5 ether);
        vm.prank(BOB);
        assertTrue(token.transferFrom(ALICE, BOB, 5 ether));
        assertEq(token.balanceOf(ALICE), 7 ether);
        assertEq(token.balanceOf(BOB), 5 ether);
        assertEq(token.allowance(ALICE, BOB), 0);
        assertEq(token.totalSupply(), 1e27);
    }

    function testTransferFailureCases() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        token.transfer(BOB, 1);
        token.transfer(ALICE, 1);
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, BOB, 0, 1));
        token.transferFrom(ALICE, BOB, 1);
    }

    function testNoAdminSelectorsEvenForDeployer() public {
        bytes[8] memory calls = [
            abi.encodeWithSignature("mint(address,uint256)", ALICE, 1 ether),
            abi.encodeWithSignature("burn(uint256)", 1 ether),
            abi.encodeWithSignature("transferOwnership(address)", ALICE),
            abi.encodeWithSignature("initialize(address)", ALICE),
            abi.encodeWithSignature("upgradeTo(address)", ALICE),
            abi.encodeWithSignature("pause()"),
            abi.encodeWithSignature("setFee(uint256)", 1),
            abi.encodeWithSignature("setMinter(address)", ALICE)
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok,) = address(token).call(calls[i]);
            assertFalse(ok);
        }
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
    }

    function testFuzzTransferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, 1e27);
        token.transfer(ALICE, amount);
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(ALICE), token.totalSupply());
    }
}
