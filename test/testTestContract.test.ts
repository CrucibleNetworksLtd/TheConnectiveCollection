import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts} from 'hardhat';
import {setupUsers} from './utils';
import {TestContract} from '../typechain/TestContract';
import {MerkleTree} from 'merkletreejs';
import keccak256 from 'keccak256';
import {Test} from 'mocha';

const setup = deployments.createFixture(async () => {
  await deployments.fixture('TestContract');

  const testContract = await deployments.get('TestContract');

  const contracts = {
    TestContract: <TestContract>(
      await ethers.getContractAt(testContract.abi, testContract.address)
    ),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
  };
});

const generateMerkleTree = (addresses: string[]) => {
  const leafNodes = addresses.map((addr) => keccak256(addr));
  return new MerkleTree(leafNodes, keccak256, {sortPairs: true});
};

describe('TestContract', function () {
  it('can mint for free (Stage 0)', async function () {
    const {users, TestContract} = await setup();

    const freeWhitelist = [users[0].address];
    const freeMerkleTree = generateMerkleTree(freeWhitelist);
    const freeMerkleRoot = freeMerkleTree.getRoot().toString('hex');
    await TestContract.setFreeMerkleRoot('0x' + freeMerkleRoot);

    const leaf = keccak256(users[0].address);
    const proof = freeMerkleTree.getHexProof(leaf);

    await TestContract.setMintingState(0);
    await TestContract.toggleMintingIsActive();

    await expect(users[0].TestContract.mint(proof, {value: 0}))
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[0].address,
        1
      );

    console.log('Owner of tokenId 1 is: ' + (await TestContract.ownerOf(1)));

    // Test that a user not on the free whitelist cannot mint
    const invalidProof = freeMerkleTree.getHexProof(
      keccak256(users[1].address)
    );
    await expect(
      users[1].TestContract.mint(invalidProof, {value: 0})
    ).to.be.revertedWith('Invalid proof for free minting');
  });

  it('can mint for a price (Stage 1)', async function () {
    const {users, TestContract} = await setup();

    const paidWhitelist = [users[1].address];
    const paidMerkleTree = generateMerkleTree(paidWhitelist);
    const paidMerkleRoot = paidMerkleTree.getRoot().toString('hex');
    await TestContract.setPaidMerkleRoot('0x' + paidMerkleRoot);

    const leaf = keccak256(users[1].address);
    const proof = paidMerkleTree.getHexProof(leaf);

    await TestContract.setMintingState(1);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.1');
    await expect(users[1].TestContract.mint(proof, {value: mintPrice}))
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[1].address,
        1
      );

    console.log('Owner of tokenId 2 is: ' + (await TestContract.ownerOf(1)));

    // Test that a user not on the paid whitelist cannot mint
    const invalidProof = paidMerkleTree.getHexProof(
      keccak256(users[0].address)
    );
    await expect(
      users[0].TestContract.mint(invalidProof, {value: mintPrice})
    ).to.be.revertedWith('Invalid proof for paid minting');
  });

  it('anyone can mint for a price (Stage 2)', async function () {
    const {users, TestContract} = await setup();

    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.1');
    await expect(users[2].TestContract.mint([], {value: mintPrice}))
      .to.emit(TestContract, 'Transfer')
      .withArgs(
        '0x0000000000000000000000000000000000000000',
        users[2].address,
        1
      );

    console.log('Owner of tokenId 1 is: ' + (await TestContract.ownerOf(1)));
  });
  it('only the owner can withdraw funds', async function () {
    const {users, TestContract} = await setup();

    // Get the owner of the contract (the deployer)
    const [deployer] = await ethers.getSigners();

    await TestContract.setMintingState(2);
    await TestContract.toggleMintingIsActive();

    const mintPrice = ethers.utils.parseEther('0.1');
    await users[2].TestContract.mint([], {value: mintPrice});

    const ownerBalanceBefore = await ethers.provider.getBalance(
      deployer.address
    );

    // Non-owner tries to withdraw (should fail)
    await expect(users[1].TestContract.withdraw()).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );

    // Owner withdraws
    const tx = await TestContract.connect(deployer).withdraw();
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

    const ownerBalanceAfter = await ethers.provider.getBalance(
      deployer.address
    );

    // Use BigNumber arithmetic for comparison
    const expectedBalanceAfter = ownerBalanceBefore.add(mintPrice).sub(gasUsed);

    // Ensure the balances are equal
    expect(ownerBalanceAfter).to.equal(expectedBalanceAfter);
  });
});
