package handlers

import (
	"net/http"

	"game-server/helper"
	"game-server/types"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{}

func createRoomHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	roomID := helper.GenerateRoomID()

	room := &types.Room{
		Id:      roomID,
		Players: make(map[*types.Client]bool),
	}
}
