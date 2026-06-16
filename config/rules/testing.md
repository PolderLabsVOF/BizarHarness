# Testing Rules

- Write tests before implementation (TDD) for all new features
- Aim for 80%+ code coverage on all new code
- Use Arrange-Act-Assert (AAA) pattern in all tests
- One assertion per test — or use parameterized tests for multiple cases
- Mock external services, not internal logic
- Name tests descriptively: `test_{function}_{scenario}_{expected_behavior}`
- Test edge cases, error paths, and boundary conditions, not just happy path
- Integration tests should be clearly separated from unit tests