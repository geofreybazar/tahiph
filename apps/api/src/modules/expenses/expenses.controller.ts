import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { expenseInputSchema, listExpensesSchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { ExpensesService } from './expenses.service';

class ExpenseInputDto extends createZodDto(expenseInputSchema) {}
class ListExpensesDto extends createZodDto(listExpensesSchema) {}

@Controller('expenses')
@TenantRoute('expenses:manage')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query() query: ListExpensesDto) {
    return this.expenses.list(query as never);
  }

  @Post()
  create(@Body() body: ExpenseInputDto) {
    return this.expenses.create(body as never);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: ExpenseInputDto) {
    return this.expenses.update(id, body as never);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.remove(id);
  }
}
