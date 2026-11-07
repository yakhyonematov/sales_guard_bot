import { Test, TestingModule } from '@nestjs/testing';
import { ManagersService } from './managers.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('ManagersService', () => {
  let service: ManagersService;
  let prisma: PrismaService;

  const mockPrisma = {
    manager: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    rop: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManagersService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ManagersService>(ManagersService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw NotFoundException if ROP does not exist', async () => {
      mockPrisma.rop.findUnique.mockResolvedValue(null);

      await expect(service.create('Alisher Vohidov', 'non-existing-rop')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create manager and assign to ROP', async () => {
      mockPrisma.rop.findUnique.mockResolvedValue({ id: 'rop-1' });
      mockPrisma.manager.create.mockResolvedValue({
        id: 'm-1',
        fullName: 'Alisher Vohidov',
        ropId: 'rop-1',
        isActive: true,
      });

      const result = await service.create('Alisher Vohidov', 'rop-1');
      expect(result.id).toBe('m-1');
      expect(mockPrisma.manager.create).toHaveBeenCalledWith({
        data: { fullName: 'Alisher Vohidov', ropId: 'rop-1', isActive: true },
        include: { rop: { include: { user: true } } },
      });
    });
  });

  describe('assignToRop', () => {
    it('should reassign manager to another ROP', async () => {
      mockPrisma.rop.findUnique.mockResolvedValue({ id: 'rop-2' });
      mockPrisma.manager.update.mockResolvedValue({
        id: 'm-1',
        ropId: 'rop-2',
        fullName: 'Alisher Vohidov',
      });

      const updated = await service.assignToRop('m-1', 'rop-2');
      expect(updated.ropId).toBe('rop-2');
      expect(mockPrisma.manager.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { ropId: 'rop-2' },
        include: { rop: { include: { user: true } }, user: true },
      });
    });
  });

  describe('list', () => {
    it('should list managers with search query and pagination', async () => {
      mockPrisma.manager.findMany.mockResolvedValue([
        { id: 'm-1', fullName: 'Ali Valiyev', ropId: 'rop-1' },
      ]);
      mockPrisma.manager.count.mockResolvedValue(1);

      const result = await service.list({ search: 'Ali', page: 1, limit: 6 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.manager.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fullName: { contains: 'Ali', mode: 'insensitive' } },
          skip: 0,
          take: 6,
        }),
      );
    });
  });

  describe('deleteOrDeactivate', () => {
    it('should deactivate manager if violations exist', async () => {
      mockPrisma.manager.findUnique.mockResolvedValue({
        id: 'm-1',
        _count: { violations: 3 },
      });
      mockPrisma.manager.update.mockResolvedValue({ id: 'm-1', isActive: false });

      await service.deleteOrDeactivate('m-1');
      expect(mockPrisma.manager.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { isActive: false },
      });
      expect(mockPrisma.manager.delete).not.toHaveBeenCalled();
    });

    it('should permanently delete manager if no violations exist', async () => {
      mockPrisma.manager.findUnique.mockResolvedValue({
        id: 'm-1',
        _count: { violations: 0 },
      });
      mockPrisma.manager.delete.mockResolvedValue({ id: 'm-1' });

      await service.deleteOrDeactivate('m-1');
      expect(mockPrisma.manager.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
    });
  });
});
