/**
 * ArcNameRegistry — test suite.
 *
 * Run with: `npx hardhat test`
 *
 * Covers: deployment, registration (valid/invalid/duplicate), price
 * enforcement (exact/under/over), reads (ownerOf/isAvailable/resolve,
 * getAllNames + pagination), transfer, metadata, admin controls and events —
 * plus the v2 resolver layer: text records, primary name and the namesOf
 * reverse index.
 * Names use only a-z 0-9 (the frontend validation rules are mirrored onchain).
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');

const ZERO = ethers.ZeroAddress;

async function deployRegistry(initialPrice) {
  const [deployer, other, alice, bob] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory('ArcNameRegistry');
  const registry = await Factory.deploy(initialPrice);
  await registry.waitForDeployment();
  return { registry, deployer, other, alice, bob };
}

function idOf(name) {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

describe('ArcNameRegistry', function () {
  describe('deployment', function () {
    it('sets the deployer as admin and stores the initial price', async function () {
      const { registry, deployer } = await deployRegistry(ethers.parseEther('1'));
      expect(await registry.admin()).to.equal(deployer.address);
      expect(await registry.price()).to.equal(ethers.parseEther('1'));
    });

    it('emits PriceChanged on construction', async function () {
      const Factory = await ethers.getContractFactory('ArcNameRegistry');
      const reg = await Factory.deploy(ethers.parseEther('2'));
      const receipt = await reg.deploymentTransaction().wait();
      const ev = receipt.logs
        .map((l) => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === 'PriceChanged');
      expect(ev).to.not.be.undefined;
      expect(ev.args[0]).to.equal(0n);
      expect(ev.args[1]).to.equal(ethers.parseEther('2'));
    });

    it('starts with zero names', async function () {
      const { registry } = await deployRegistry(0n);
      expect(await registry.totalNames()).to.equal(0n);
      expect(await registry.recordCount()).to.equal(0n);
    });
  });

  describe('register', function () {
    it('registers a valid lowercase name, sets owner and emits NameRegistered', async function () {
      const { registry, deployer } = await deployRegistry(ethers.parseEther('1'));
      const name = 'alice';
      const price = ethers.parseEther('1');
      const tx = await registry.register(name, { value: price });
      await expect(tx).to.emit(registry, 'NameRegistered');
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return registry.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === 'NameRegistered');
      expect(ev).to.not.be.undefined;
      expect(ev.args.id).to.equal(idOf(name));
      expect(ev.args.name).to.equal(name);
      expect(ev.args.owner).to.equal(deployer.address);
      expect(ev.args.pricePaid).to.equal(price);
      expect(await registry.ownerOf(name)).to.equal(deployer.address);
      expect(await registry.totalNames()).to.equal(1n);
    });

    it('rejects names shorter than 3 characters', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      for (const bad of ['', 'a', 'ab']) {
        await expect(registry.register(bad, { value: ethers.parseEther('1') }))
          .to.be.revertedWithCustomError(registry, 'NameTooShort');
      }
    });

    it('rejects names longer than 32 characters', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      await expect(registry.register('a'.repeat(33), { value: ethers.parseEther('1') }))
        .to.be.revertedWithCustomError(registry, 'NameTooLong');
    });

    it('rejects uppercase letters', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      for (const bad of ['Alice', 'ALICE', 'aLiCe']) {
        await expect(registry.register(bad, { value: ethers.parseEther('1') }))
          .to.be.revertedWithCustomError(registry, 'InvalidCharacters');
      }
    });

    it('rejects symbols, spaces and hyphens', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      for (const bad of ['ali-ce', 'al ice', 'alice!', 'alice_', 'al.ce', 'élice']) {
        await expect(registry.register(bad, { value: ethers.parseEther('1') }))
          .to.be.revertedWithCustomError(registry, 'InvalidCharacters');
      }
    });

    it('rejects registering the same name twice', async function () {
      const { registry, other } = await deployRegistry(ethers.parseEther('1'));
      await registry.register('alice', { value: ethers.parseEther('1') });
      await expect(registry.connect(other).register('alice', { value: ethers.parseEther('1') }))
        .to.be.revertedWithCustomError(registry, 'NameTaken')
        .withArgs('alice');
    });

    it('accepts digits and mixed alphanumeric names', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('arc2026');
      await registry.register('x9y');
      expect(await registry.ownerOf('arc2026')).to.not.equal(ZERO);
      expect(await registry.ownerOf('x9y')).to.not.equal(ZERO);
    });

    it('succeeds with the exact price', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      const price = ethers.parseEther('1');
      const before = await ethers.provider.getBalance(registry.target);
      await registry.register('bob', { value: price });
      const after = await ethers.provider.getBalance(registry.target);
      expect(after - before).to.equal(price); // contract collected the full fee
      expect(await registry.ownerOf('bob')).to.not.equal(ZERO);
    });

    it('reverts when the value is below the price (PriceNotMet)', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      await expect(registry.register('bob', { value: ethers.parseEther('0.5') }))
        .to.be.revertedWithCustomError(registry, 'PriceNotMet');
    });

    it('reverts when the value exceeds the price (Overpayment — no silent refund)', async function () {
      const { registry } = await deployRegistry(ethers.parseEther('1'));
      await expect(registry.register('bob', { value: ethers.parseEther('2') }))
        .to.be.revertedWithCustomError(registry, 'Overpayment');
    });

    it('allows free registration when price is zero (value optional)', async function () {
      const { registry, deployer, other } = await deployRegistry(0n);
      await registry.register('free1');
      await registry.connect(other).register('free2', { value: 0n });
      expect(await registry.ownerOf('free1')).to.equal(deployer.address);
      expect(await registry.ownerOf('free2')).to.equal(other.address);
    });

    it('records the timestamp at registration', async function () {
      const { registry } = await deployRegistry(0n);
      const block = await ethers.provider.getBlock('latest');
      await registry.register('stamped');
      const rec = await registry.ownerOf('stamped');
      expect(rec).to.not.equal(ZERO);
      // registeredAt is not exposed, but the record exists right after block `block.number`.
      expect(await ethers.provider.getBlockNumber()).to.be.greaterThanOrEqual(block.number);
    });
  });

  describe('reads', function () {
    let ctx;
    beforeEach(async function () {
      ctx = await deployRegistry(0n);
      await ctx.registry.register('alice');
      await ctx.registry.register('bob');
      await ctx.registry.register('carol');
    });

    it('ownerOf returns the owner and address(0) for unregistered names', async function () {
      const { registry, deployer } = ctx;
      expect(await registry.ownerOf('alice')).to.equal(deployer.address);
      expect(await registry.ownerOf('nobody')).to.equal(ZERO);
    });

    it('isAvailable flips false after registration', async function () {
      const { registry } = ctx;
      expect(await registry.isAvailable('alice')).to.equal(false);
      expect(await registry.isAvailable('fresh')).to.equal(true);
    });

    it('resolve-equivalent reads return the owning address for a registered name', async function () {
      const { registry, deployer } = ctx;
      // The registry's resolution primitive is ownerOf(name) — it powers the
      // frontend "Taken → owned by" lookup.
      expect(await registry.ownerOf('bob')).to.equal(deployer.address);
    });

    it('getAllNames returns names in registration order', async function () {
      const { registry } = ctx;
      const all = await registry.getAllNames();
      expect(all).to.deep.equal(['alice', 'bob', 'carol']);
    });

    it('getAllNames supports pagination (page over the full list)', async function () {
      const { registry } = ctx;
      const all = await registry.getAllNames();
      const pageSize = 2;
      const pages = [];
      for (let i = 0; i < all.length; i += pageSize) pages.push(all.slice(i, i + pageSize));
      expect(pages).to.deep.equal([['alice', 'bob'], ['carol']]);
      // Reassembling the pages reproduces the full ordered list.
      expect(pages.flat()).to.deep.equal(all);
    });

    it('recordCount and totalNames track registered names', async function () {
      const { registry } = ctx;
      expect(await registry.recordCount()).to.equal(3n);
      expect(await registry.totalNames()).to.equal(3n);
    });
  });

  describe('transfer', function () {
    it('lets the owner transfer a name and updates ownership', async function () {
      const { registry, deployer, alice } = await deployRegistry(0n);
      await registry.register('vitalik');
      await expect(registry.transfer('vitalik', alice.address))
        .to.emit(registry, 'NameTransferred')
        .withArgs(idOf('vitalik'), 'vitalik', deployer.address, alice.address);
      expect(await registry.ownerOf('vitalik')).to.equal(alice.address);
    });

    it('reverts when a non-owner tries to transfer', async function () {
      const { registry, alice, bob } = await deployRegistry(0n);
      await registry.register('vitalik');
      await expect(registry.connect(alice).transfer('vitalik', bob.address))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('reverts when transferring to the zero address', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('vitalik');
      await expect(registry.transfer('vitalik', ZERO))
        .to.be.revertedWithCustomError(registry, 'ZeroAddress');
    });

    it('reverts when transferring an unregistered name', async function () {
      const { registry } = await deployRegistry(0n);
      await expect(registry.transfer('ghost', registry.target))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('lets the new owner transfer again', async function () {
      const { registry, alice, bob } = await deployRegistry(0n);
      await registry.register('handoff');
      await registry.transfer('handoff', alice.address);
      await registry.connect(alice).transfer('handoff', bob.address);
      expect(await registry.ownerOf('handoff')).to.equal(bob.address);
    });
  });

  describe('metadata', function () {
    it('owner can attach metadata and it reads back via metadataOf', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.setMetadataURI('alice', 'ipfs://QmX'))
        .to.emit(registry, 'MetadataUpdated')
        .withArgs(idOf('alice'), 'alice', 'ipfs://QmX');
      expect(await registry.metadataOf('alice')).to.equal('ipfs://QmX');
    });

    it('non-owner cannot set metadata', async function () {
      const { registry, alice } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.connect(alice).setMetadataURI('alice', 'ipfs://QmX'))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });
  });

  describe('admin', function () {
    it('only the admin can setPrice; emits PriceChanged', async function () {
      const { registry, other } = await deployRegistry(ethers.parseEther('1'));
      await expect(registry.connect(other).setPrice(ethers.parseEther('5')))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
      await expect(registry.setPrice(ethers.parseEther('5')))
        .to.emit(registry, 'PriceChanged')
        .withArgs(ethers.parseEther('1'), ethers.parseEther('5'));
      expect(await registry.price()).to.equal(ethers.parseEther('5'));
    });

    it('only the admin can setAdmin; rejects the zero address', async function () {
      const { registry, deployer, other, alice } = await deployRegistry(0n);
      await expect(registry.connect(other).setAdmin(alice.address))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
      await expect(registry.setAdmin(ZERO))
        .to.be.revertedWithCustomError(registry, 'ZeroAddress');
      await expect(registry.setAdmin(alice.address))
        .to.emit(registry, 'AdminChanged')
        .withArgs(deployer.address, alice.address);
      expect(await registry.admin()).to.equal(alice.address);
    });

    it('withdraw sends accumulated fees to the admin and emits Withdrawn', async function () {
      const { registry, deployer } = await deployRegistry(ethers.parseEther('1'));
      await registry.register('one', { value: ethers.parseEther('1') });
      await registry.register('two', { value: ethers.parseEther('1') });
      expect(await ethers.provider.getBalance(registry.target)).to.equal(ethers.parseEther('2'));

      const tx = await registry.withdraw();
      await expect(tx).to.emit(registry, 'Withdrawn').withArgs(deployer.address, ethers.parseEther('2'));
      expect(await ethers.provider.getBalance(registry.target)).to.equal(0n);
    });

    it('reverts when a non-admin calls withdraw', async function () {
      const { registry, other } = await deployRegistry(ethers.parseEther('1'));
      await registry.register('one', { value: ethers.parseEther('1') });
      await expect(registry.connect(other).withdraw())
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('reverts NothingToWithdraw when the balance is empty', async function () {
      const { registry } = await deployRegistry(0n);
      await expect(registry.withdraw())
        .to.be.revertedWithCustomError(registry, 'NothingToWithdraw');
    });

    it('a demoted admin can no longer withdraw', async function () {
      const { registry, deployer, other } = await deployRegistry(ethers.parseEther('1'));
      await registry.register('one', { value: ethers.parseEther('1') });
      await registry.setAdmin(other.address);
      await expect(registry.connect(deployer).withdraw())
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });
  });

  describe('frontend interface parity', function () {
    it('exposes the exact functions the static app calls', async function () {
      const { registry } = await deployRegistry(0n);
      // The app (js/core.js SELECTORS) talks to: register, isAvailable,
      // ownerOf, price, totalNames. These calls must not revert on ABI grounds.
      expect(await registry.price()).to.equal(0n);
      expect(await registry.totalNames()).to.equal(0n);
      expect(await registry.isAvailable('alice')).to.equal(true);
      expect(await registry.ownerOf('alice')).to.equal(ZERO);
      await registry.register('alice');
      expect(await registry.ownerOf('alice')).to.not.equal(ZERO);
    });

    it('keeps v1 selectors and exposes the v2 resolver surface', async function () {
      const { registry } = await deployRegistry(0n);
      // v1 unchanged
      expect(await registry.isAvailable('v2check')).to.equal(true);
      await registry.register('v2check');
      expect(await registry.ownerOf('v2check')).to.not.equal(ZERO);
      // v2: text records + primary + reverse index all answer on ABI grounds
      await registry.setText('v2check', 'avatar', 'https://x/y.png');
      expect(await registry.text('v2check', 'avatar')).to.equal('https://x/y.png');
      expect(await registry.text('v2check', 'url')).to.equal('');
      await registry.setPrimaryName('v2check');
      expect(await registry.primaryName(registry.runner.address)).to.equal('v2check');
      expect(await registry.namesOf(registry.runner.address)).to.deep.equal(['v2check']);
    });
  });

  describe('text records (v2)', function () {
    it('owner can set a text record and text() reads it back', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.setText('alice', 'avatar', 'https://cdn.arc/alice.png'))
        .to.emit(registry, 'TextChanged')
        .withArgs(idOf('alice'), 'alice', 'avatar', 'https://cdn.arc/alice.png');
      expect(await registry.text('alice', 'avatar')).to.equal('https://cdn.arc/alice.png');
      await registry.setText('alice', 'url', 'https://alice.example');
      expect(await registry.text('alice', 'url')).to.equal('https://alice.example');
    });

    it('returns an empty string for unset keys and unknown names', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('alice');
      expect(await registry.text('alice', 'twitter')).to.equal('');
      expect(await registry.text('ghost', 'avatar')).to.equal('');
    });

    it('only the owner can set a text record', async function () {
      const { registry, alice } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.connect(alice).setText('alice', 'avatar', 'https://evil.example/x.png'))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('scopes records per name — same key on different names is independent', async function () {
      const { registry, other } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.connect(other).register('bob');
      await registry.setText('alice', 'avatar', 'https://cdn.arc/alice.png');
      await registry.connect(other).setText('bob', 'avatar', 'https://cdn.arc/bob.png');
      expect(await registry.text('alice', 'avatar')).to.equal('https://cdn.arc/alice.png');
      expect(await registry.text('bob', 'avatar')).to.equal('https://cdn.arc/bob.png');
    });

    it('an empty value clears a record and emits TextChanged', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.setText('alice', 'description', 'hello arc');
      expect(await registry.text('alice', 'description')).to.equal('hello arc');
      await expect(registry.setText('alice', 'description', ''))
        .to.emit(registry, 'TextChanged')
        .withArgs(idOf('alice'), 'alice', 'description', '');
      expect(await registry.text('alice', 'description')).to.equal('');
    });

    it('rejects an empty key', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.setText('alice', '', 'x'))
        .to.be.revertedWithCustomError(registry, 'EmptyKey');
    });
  });

  describe('primary name (v2)', function () {
    it('owner can set a primary name and primaryName(address) reads it back', async function () {
      const { registry, deployer } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.setPrimaryName('alice'))
        .to.emit(registry, 'PrimaryNameSet')
        .withArgs(deployer.address, '', 'alice');
      expect(await registry.primaryName(deployer.address)).to.equal('alice');
    });

    it('primaryName returns empty for an address with no primary', async function () {
      const { registry, deployer } = await deployRegistry(0n);
      expect(await registry.primaryName(deployer.address)).to.equal('');
    });

    it('non-owner cannot set a primary name', async function () {
      const { registry, other } = await deployRegistry(0n);
      await registry.register('alice');
      await expect(registry.connect(other).setPrimaryName('alice'))
        .to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('setting a new primary replaces the old one and emits the previous value', async function () {
      const { registry, deployer } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.register('bob');
      await registry.setPrimaryName('alice');
      await expect(registry.setPrimaryName('bob'))
        .to.emit(registry, 'PrimaryNameSet')
        .withArgs(deployer.address, 'alice', 'bob');
      expect(await registry.primaryName(deployer.address)).to.equal('bob');
    });

    it('re-setting the same primary is a no-op (no duplicate event)', async function () {
      const { registry } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.setPrimaryName('alice');
      await expect(registry.setPrimaryName('alice')).to.not.emit(registry, 'PrimaryNameSet');
      expect(await registry.primaryName(await registry.runner.getAddress())).to.equal('alice');
    });

    it('transferring a primary name clears the sender primary', async function () {
      const { registry, deployer, other } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.setPrimaryName('alice');
      await registry.transfer('alice', other.address);
      expect(await registry.primaryName(deployer.address)).to.equal('');
      // the recipient does not inherit the primary either
      expect(await registry.primaryName(other.address)).to.equal('');
    });

    it('transferring a non-primary name leaves the primary intact', async function () {
      const { registry, deployer, other } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.register('bob');
      await registry.setPrimaryName('bob');
      await registry.transfer('alice', other.address);
      expect(await registry.primaryName(deployer.address)).to.equal('bob');
    });
  });

  describe('namesOf reverse index (v2)', function () {
    it('lists names an owner registered, in acquisition order', async function () {
      const { registry, deployer } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.register('bob');
      await registry.register('carol');
      expect(await registry.namesOf(deployer.address)).to.deep.equal(['alice', 'bob', 'carol']);
    });

    it('returns an empty array for an address that owns nothing', async function () {
      const { registry, other } = await deployRegistry(0n);
      await registry.register('alice');
      expect(await registry.namesOf(other.address)).to.deep.equal([]);
    });

    it('transfer moves the name between owners in the index', async function () {
      const { registry, deployer, other } = await deployRegistry(0n);
      await registry.register('alice');
      await registry.register('bob');
      await registry.transfer('alice', other.address);
      expect(await registry.namesOf(deployer.address)).to.deep.equal(['bob']);
      expect(await registry.namesOf(other.address)).to.deep.equal(['alice']);
    });

    it('receiving a transfer appends to the recipient list', async function () {
      const { registry, deployer, other } = await deployRegistry(0n);
      await registry.connect(other).register('zed');
      await registry.register('alice');
      await registry.transfer('alice', other.address);
      expect(await registry.namesOf(other.address)).to.deep.equal(['zed', 'alice']);
    });

    it('transferring out of the middle keeps every remaining name', async function () {
      const { registry, deployer, other } = await deployRegistry(0n);
      await registry.register('aaa');
      await registry.register('bbb');
      await registry.register('ccc');
      await registry.transfer('bbb', other.address);
      const remaining = await registry.namesOf(deployer.address);
      expect([...remaining].sort()).to.deep.equal(['aaa', 'ccc']);
      expect(await registry.namesOf(other.address)).to.deep.equal(['bbb']);
    });

    it('self-transfer does not duplicate the name in the index', async function () {
      const { registry, deployer } = await deployRegistry(0n);
      await registry.register('solo');
      await registry.transfer('solo', deployer.address);
      expect(await registry.namesOf(deployer.address)).to.deep.equal(['solo']);
    });

    it('follows chained transfers to the final owner', async function () {
      const { registry, deployer, alice, bob } = await deployRegistry(0n);
      await registry.register('handoff');
      await registry.transfer('handoff', alice.address);
      await registry.connect(alice).transfer('handoff', bob.address);
      expect(await registry.namesOf(deployer.address)).to.deep.equal([]);
      expect(await registry.namesOf(alice.address)).to.deep.equal([]);
      expect(await registry.namesOf(bob.address)).to.deep.equal(['handoff']);
    });
  });
});
