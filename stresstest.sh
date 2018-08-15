#!/bin/bash

TOTAL=200
RESULTS=result.txt

rm -rf $RESULTS
touch $RESULTS

test () {
    i=$1

    result=$(curl -sX GET http://localhost:1880/xx?a=$i)

    if [ "$result" != "$i" ]; then
        echo 1 >> $RESULTS
        echo $result >> error.log
    fi
}

for i in $(seq 1 $TOTAL);
do
    test $i &
    pids[${i}]=$!
done

for pid in ${pids[*]}; do
    wait $pid
done

echo "Wrong result count: $(wc -l $RESULTS)"
