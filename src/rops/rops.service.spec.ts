import { Test, TestingModule } from '@nestjs/testing';
import { RopsService } from './rops.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';

describe('RopsService', () => {
  let service: RopsService;
  let prisma: PrismaService;

  const mockPrisma = {
    rop: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    manager: {
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RopsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<RopsService>(RopsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRop', () => {
    it('should create ROP with telegramId when user is new', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-1',
        telegramId: 123456n,
        fullName: 'Davron Fayziyev',
        role: UserRole.ROP,
      });
      mockPrisma.rop.create.mockResolvedValue({
        id: 'r-1',
        userId: 'u-1',
        isActive: true,
        user: { fullName: 'Davron Fayziyev' },
      });

      const result = await service.createRop('Davron Fayziyev', 123456n);

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          telegramId: 123456n,
          fullName: 'Davron Fayziyev',
          role: UserRole.ROP,
        }),
      });
      expect(result.id).toBe('r-1');
    });

    it('should create ROP without telegramId using placeholder', async () => {
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-placeholder',
        telegramId: -999999n,
        fullName: 'Botir Rahimov',
        role: UserRole.ROP,
      });
      mockPrisma.rop.create.mockResolvedValue({
        id: 'r-2',
        userId: 'u-placeholder',
        isActive: true,
        user: { fullName: 'Botir Rahimov' },
      });

      const result = await service.createRop('Botir Rahimov');

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fullName: 'Botir Rahimov',
          role: UserRole.ROP,
        }),
      });
      expect(result.id).toBe('r-2');
    });
  });

  describe('list and findById', () => {
    it('should list all active ROPS', async () => {
      mockPrisma.rop.findMany.mockResolvedValue([
        { id: 'r-1', isActive: true, user: { fullName: 'ROP 1' } },
      ]);

      const list = await service.list(true);
      expect(list).toHaveLength(1);
      expect(mockPrisma.rop.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        include: expect.any(Object),
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should find ROP by id with managers', async () => {
      mockPrisma.rop.findUnique.mockResolvedValue({
        id: 'r-1',
        user: { fullName: 'ROP 1' },
        managers: [{ id: 'm-1', fullName: 'Mgr 1' }],
      });

      const rop = await service.findById('r-1');
      expect(rop?.id).toBe('r-1');
      expect(rop?.managers).toHaveLength(1);
    });
  });
});
