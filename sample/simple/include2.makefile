# Clean rule to delete generated files
.PHONY: clean
clean2:
	rm -f *.o $(TARGET)

# Rule to compile functions.c into functions.o
functions2.o: functions.c functions.h
	$(CC) $(CFLAGS) -c functions.c
